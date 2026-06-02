// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, safeStorage, session, BrowserWindow } from 'electron'
import { createMainWindow, createSnapshotWindow } from './window.js'
import { prepareRenderer } from './dev-server.js'
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
import { CapabilityStore } from './micro-apps/capabilities.js'
import { CredentialBroker } from './micro-apps/broker.js'
import { installSessionPolicy } from './micro-apps/session-policy.js'
import { startAgentBridge } from './agent-bridge.js'
import { ensureWorkspace } from './packaging/workspace.js'

// The repo is the agent's working directory — editing it IS self-modification.
// In dev that's the project root; in a packaged self-evolving build it's the
// app's writable copy of its own source (v2), seeded under userData on first
// launch. Resolved by resolveRepoRoot() at boot.
async function resolveRepoRoot(): Promise<string> {
  if (process.env.HEARTH_REPO_ROOT) return process.env.HEARTH_REPO_ROOT
  if (!app.isPackaged) return process.cwd()
  // Packaged: copy the shipped, read-only source into a writable workspace and
  // run (Vite root + git) from there. Shipped source + node_modules live under
  // Resources/app-source (see electron-builder config in package.json).
  const sourceDir = join(process.resourcesPath, 'app-source')
  return ensureWorkspace({
    workspaceDir: join(app.getPath('userData'), 'workspace'),
    sourceDir,
    nodeModulesDir: join(sourceDir, 'node_modules'),
    version: app.getVersion(),
  })
}

// Which backend to drive: HEARTH_AGENT=codex selects Codex, otherwise Claude.
function resolveBackend(): AgentKind {
  return process.env.HEARTH_AGENT?.toLowerCase() === 'codex' ? 'codex' : 'claude'
}

// Build the agent factory. Auth resolves per kind (stored BYO key → env key →
// subscription; see auth-config). The user's configured MCP servers are supplied
// to each backend, resolved (secrets injected) lazily at session creation so
// tokens never sit in a config file. HEARTH_FAKE_AGENT=1 forces the scripted
// agent (UI/permission dev without a live model).
function makeAgentFactory(secrets: SecretStore, mcp: McpRegistry, repoRoot: string): AgentFactory {
  const userMcpServers = async () => toAcpServers(mcp.list(), secrets).servers
  return (kind: AgentKind): Agent => {
    if (process.env.HEARTH_FAKE_AGENT) return new FakeAgent()
    const auth = resolveAuth(kind, secrets)
    return kind === 'codex'
      ? new CodexAgent({ kind: 'codex', cwd: repoRoot, auth }, userMcpServers)
      : new ClaudeAgent({ kind: 'claude', cwd: repoRoot, auth }, userMcpServers)
  }
}

async function bootstrap(): Promise<void> {
  // Resolve the writable repo root first — in a packaged build this seeds the
  // userData workspace, which everything below (watchdog revert, self-mod, Vite
  // root) operates on.
  const REPO_ROOT = await resolveRepoRoot()

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

  // Resolve how the renderer loads: dev server URL, or (packaged) our own Vite
  // server rooted at the workspace, falling back to the static bundle. Done after
  // the watchdog's relaunch branch so we never start a server we're about to kill.
  const renderer = await prepareRenderer(REPO_ROOT)
  app.once('before-quit', () => void renderer.close())

  const window = createMainWindow(renderer.target)

  // Encrypted secret store (BYO API keys + MCP env) and the user's MCP server
  // registry. Both live under userData. Created before the host because the agent
  // factory reads them to resolve auth + MCP servers.
  const dataDir = app.getPath('userData')
  const secrets = new SecretStore(join(dataDir, 'secrets.json'), safeStorageBackend(safeStorage))
  const mcp = new McpRegistry(join(dataDir, 'mcp-servers.json'))

  // Micro-app egress hardening: the approved-host store (W6) and the credential
  // broker (W7), plus the session policy (W2 permission deny + W3/W6 CSP headers).
  // The CSP a micro-app gets is enforced here by Hearth's session, not by the
  // app's own (untrusted) Vite config.
  const capabilities = new CapabilityStore(join(dataDir, 'capabilities.json'))
  const broker = new CredentialBroker({ capabilities, secrets })
  broker.start().catch((err) => console.error('[hearth] credential broker failed to start:', err))
  app.once('before-quit', () => void broker.close())
  installSessionPolicy(session.defaultSession, {
    shellOrigins: [renderer.target.url ?? 'file://'],
    capabilities,
    brokerOrigin: () => broker.origin(),
  })

  // The host owns the current backend and swaps it at runtime; IPC talks to it,
  // not to a fixed agent. Starts on the env-selected backend (default Claude).
  const host = new AgentHost(makeAgentFactory(secrets, mcp, REPO_ROOT), resolveBackend())
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
  startAgentBridge(
    { mainWindow: window, createSnapshotWindow: () => createSnapshotWindow(renderer.target), browser },
    REPO_ROOT,
  )

  registerIpc({ repoRoot: REPO_ROOT, host, selfMod, workspaces, sessions, browser, window, secrets, mcp, capabilities, broker })

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
