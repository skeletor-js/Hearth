// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, BrowserWindow } from 'electron'
import { createMainWindow, createSnapshotWindow } from './window.js'
import { registerIpc } from './ipc.js'
import { ClaudeAgent } from './agents/claude.js'
import { CodexAgent } from './agents/codex.js'
import { FakeAgent } from './agents/fake.js'
import { AgentHost } from './agents/agent-host.js'
import type { Agent, AgentAuth, AgentKind } from './agents/agent.js'
import { SelfModService } from './self-mod/self-mod-service.js'
import { HmrController } from './self-mod/hmr.js'
import { stopAllMicroApps } from './micro-apps/server.js'
import { startSnapshotServer } from './snapshot.js'

// The repo is the agent's working directory — editing it IS self-modification.
// In dev that's the project root; in a packaged self-evolving build it's the
// app's writable copy of its own source (v2).
const REPO_ROOT = process.env.HEARTH_REPO_ROOT ?? process.cwd()

// Which backend to drive: HEARTH_AGENT=codex selects Codex, otherwise Claude.
function resolveBackend(): AgentKind {
  return process.env.HEARTH_AGENT?.toLowerCase() === 'codex' ? 'codex' : 'claude'
}

// Pick the auth mode from the environment, no code edit required. The API-key env
// var is backend-specific; if it's set we use BYO-key (the deterministic,
// COMPLIANCE-blessed path), otherwise subscription — the adapter reads the user's
// existing `claude login` / `codex login` (env token or the OS Keychain).
// We never originate or store a credential — see docs/COMPLIANCE.md.
function resolveAuth(backend: AgentKind): AgentAuth {
  const envVar = backend === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
  if (process.env[envVar]) return { mode: 'api-key', envVar }
  return { mode: 'subscription' }
}

// Build the right backend on demand. HEARTH_FAKE_AGENT=1 forces the scripted
// agent (UI/permission dev without a live model). Auth is resolved per kind.
function createAgent(kind: AgentKind): Agent {
  if (process.env.HEARTH_FAKE_AGENT) return new FakeAgent()
  const auth = resolveAuth(kind)
  return kind === 'codex'
    ? new CodexAgent({ kind: 'codex', cwd: REPO_ROOT, auth })
    : new ClaudeAgent({ kind: 'claude', cwd: REPO_ROOT, auth })
}

async function bootstrap(): Promise<void> {
  const window = createMainWindow()

  // The host owns the current backend and swaps it at runtime; IPC talks to it,
  // not to a fixed agent. Starts on the env-selected backend (default Claude).
  const host = new AgentHost(createAgent, resolveBackend())
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
  const selfMod = new SelfModService(REPO_ROOT, hmr)

  // Loopback endpoint so the agent can capture the live window (its own work).
  // Route captures use a hidden window so the user's view is never disturbed.
  startSnapshotServer({ mainWindow: window, createSnapshotWindow }, REPO_ROOT)

  registerIpc({ repoRoot: REPO_ROOT, host, selfMod, window })

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
