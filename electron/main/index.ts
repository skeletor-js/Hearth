// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, safeStorage, BrowserWindow } from 'electron'
import { createMainWindow, createSnapshotWindow } from './window.js'
import { registerIpc } from './ipc.js'
import { ClaudeAgent } from './agents/claude.js'
import { CodexAgent } from './agents/codex.js'
import { FakeAgent } from './agents/fake.js'
import { AgentHost, type AgentFactory } from './agents/agent-host.js'
import type { Agent, AgentKind } from './agents/agent.js'
import { resolveAuth } from './agents/auth-config.js'
import { SecretStore, safeStorageBackend } from './secrets/secret-store.js'
import { McpRegistry } from './mcp/registry.js'
import { toAcpServers } from './mcp/to-acp.js'
import { SelfModService } from './self-mod/self-mod-service.js'
import { HmrController } from './self-mod/hmr.js'
import { BootWatchdog } from './self-mod/boot-watchdog.js'
import { runTypecheck } from './self-mod/validate.js'
import { revertCommit } from './self-mod/git.js'
import { WorkspaceRegistry } from './workspaces/registry.js'
import { SessionStore } from './sessions/store.js'
import { BrowserManager } from './browser/browser-view.js'
import { HEARTH_CHANNELS } from '../shared/channels.js'
import { join } from 'node:path'
import { stopAllMicroApps } from './micro-apps/server.js'
import { startAgentBridge } from './agent-bridge.js'

// The repo is the agent's working directory — editing it IS self-modification.
// In dev that's the project root; in a packaged self-evolving build it's the
// app's writable copy of its own source (v2).
const REPO_ROOT = process.env.HEARTH_REPO_ROOT ?? process.cwd()

// Which backend to drive: HEARTH_AGENT=codex selects Codex, otherwise Claude.
function resolveBackend(): AgentKind {
  return process.env.HEARTH_AGENT?.toLowerCase() === 'codex' ? 'codex' : 'claude'
}

// Build the agent factory. Auth resolves per kind (stored BYO key → env key →
// subscription; see auth-config). The user's configured MCP servers are supplied
// to each backend, resolved (secrets injected) lazily at session creation so
// tokens never sit in a config file. HEARTH_FAKE_AGENT=1 forces the scripted
// agent (UI/permission dev without a live model).
function makeAgentFactory(secrets: SecretStore, mcp: McpRegistry): AgentFactory {
  const userMcpServers = async () => toAcpServers(mcp.list(), secrets).servers
  return (kind: AgentKind): Agent => {
    if (process.env.HEARTH_FAKE_AGENT) return new FakeAgent()
    const auth = resolveAuth(kind, secrets)
    return kind === 'codex'
      ? new CodexAgent({ kind: 'codex', cwd: REPO_ROOT, auth }, userMcpServers)
      : new ClaudeAgent({ kind: 'claude', cwd: REPO_ROOT, auth }, userMcpServers)
  }
}

async function bootstrap(): Promise<void> {
  // Boot watchdog (W6): if the previous self-mod restart never reached ready, it
  // bricked boot — auto-revert that commit and relaunch before anything else runs.
  const watchdog = new BootWatchdog(join(app.getPath('userData'), 'pending-self-mod-restart.json'))
  const decision = watchdog.inspectBoot()
  if (decision.action === 'revert') {
    try {
      await revertCommit(REPO_ROOT, decision.commit)
    } catch {
      // If the revert itself fails, fall through — the attempt was recorded, so a
      // repeat will hit the cap and drop to safe-mode rather than loop forever.
    }
    if (app.isPackaged) {
      app.relaunch()
      app.exit(0)
      return
    }
  } else if (decision.action === 'safe-mode') {
    console.error(`[hearth] self-mod restart bricked boot repeatedly (commit ${decision.commit}); booting current state without further auto-revert`)
  }

  const window = createMainWindow()

  // Encrypted secret store (BYO API keys + MCP env) and the user's MCP server
  // registry. Both live under userData. Created before the host because the agent
  // factory reads them to resolve auth + MCP servers.
  const dataDir = app.getPath('userData')
  const secrets = new SecretStore(join(dataDir, 'secrets.json'), safeStorageBackend(safeStorage))
  const mcp = new McpRegistry(join(dataDir, 'mcp-servers.json'))

  // The host owns the current backend and swaps it at runtime; IPC talks to it,
  // not to a fixed agent. Starts on the env-selected backend (default Claude).
  const host = new AgentHost(makeAgentFactory(secrets, mcp), resolveBackend())
  console.log(`[hearth] backend: ${host.kind}`)

  const hmr = new HmrController({
    reloadWindow: () => window.webContents.reload(),
    restartApp: () => {
      // In dev, electron-vite owns the process lifecycle and restarts the app
      // when a main-process file is *written* — self-relaunching here would kill
      // the dev session (and its Vite server), leaving a blank window. Only
      // relaunch in a packaged build; in dev a window reload is the safe fallback.
      if (app.isPackaged) {
        app.relaunch()
        app.exit(0)
      } else {
        window.webContents.reload()
      }
    },
  })
  const selfMod = new SelfModService(
    REPO_ROOT,
    hmr,
    // W6 blocking gate: typecheck before a restart-tier edit takes the app down.
    () => runTypecheck(REPO_ROOT),
    // W6: arm the watchdog with the commit about to trigger a restart.
    (commit) => watchdog.arm(commit, new Date().toISOString()),
  )

  // A successful renderer load means boot reached a healthy state — clear the
  // watchdog marker. A bricked main edit never loads, so the marker survives and
  // the next boot auto-reverts it.
  window.webContents.on('did-finish-load', () => watchdog.confirmReady())

  // Main-anchored recovery net (W3): if the renderer process dies outright (its own
  // ErrorBoundary couldn't catch it), main brings it back. Bounded so a reload loop
  // doesn't spin — after a couple of crashes, leave it for the user to act.
  let rendererCrashes = 0
  window.webContents.on('render-process-gone', (_e, details) => {
    rendererCrashes++
    console.error(`[hearth] renderer gone (${details.reason}); recovery attempt ${rendererCrashes}`)
    if (rendererCrashes <= 2 && !window.isDestroyed()) window.webContents.reload()
  })
  window.webContents.on('did-finish-load', () => {
    rendererCrashes = 0
  })

  // Workspaces + sessions persist under userData so they survive restarts and
  // never pollute the repo. Hearth itself is the built-in workspace at REPO_ROOT.
  const workspaces = new WorkspaceRegistry(join(dataDir, 'workspaces.json'), REPO_ROOT)
  const sessions = new SessionStore(join(dataDir, 'sessions'))

  // Embedded persistent browser; the agent drives the same view (browser_* tools).
  const browser = new BrowserManager(window, (state) =>
    window.webContents.send(HEARTH_CHANNELS.browserState, state),
  )

  // Loopback bridge: lets the agent see (snapshot) AND drive (eval) the live app.
  // Route captures use a hidden window so the user's view is never disturbed.
  startAgentBridge({ mainWindow: window, createSnapshotWindow, browser }, REPO_ROOT)

  registerIpc({ repoRoot: REPO_ROOT, host, selfMod, workspaces, sessions, browser, window, secrets, mcp })

  // Connect the current backend in the background; the UI renders immediately.
  // A failed connect must surface, not crash boot.
  host.connect().catch((err) => {
    window.webContents.send('agent:error', String(err))
  })
}

app.whenReady().then(bootstrap)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void bootstrap()
})

app.on('window-all-closed', () => {
  stopAllMicroApps()
  if (process.platform !== 'darwin') app.quit()
})
