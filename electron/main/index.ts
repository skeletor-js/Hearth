// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window.js'
import { registerIpc } from './ipc.js'
import { ClaudeAgent } from './agents/claude.js'
import { CodexAgent } from './agents/codex.js'
import { FakeAgent } from './agents/fake.js'
import type { Agent, AgentAuth, AgentKind } from './agents/agent.js'
import { SelfModService } from './self-mod/self-mod-service.js'
import { HmrController } from './self-mod/hmr.js'
import { stopAllMicroApps } from './micro-apps/server.js'

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

async function bootstrap(): Promise<void> {
  const window = createMainWindow()

  // HEARTH_FAKE_AGENT=1 swaps in a scripted agent for UI/permission development
  // without a live model. See agents/fake.ts.
  const backend = resolveBackend()
  const auth = resolveAuth(backend)
  console.log(`[hearth] backend: ${backend}, auth mode: ${auth.mode}`)
  const agent: Agent = process.env.HEARTH_FAKE_AGENT
    ? new FakeAgent()
    : backend === 'codex'
      ? new CodexAgent({ kind: 'codex', cwd: REPO_ROOT, auth })
      : new ClaudeAgent({ kind: 'claude', cwd: REPO_ROOT, auth })

  const hmr = new HmrController({
    reloadWindow: () => window.webContents.reload(),
    restartApp: () => {
      app.relaunch()
      app.exit(0)
    },
  })
  const selfMod = new SelfModService(REPO_ROOT, hmr)

  registerIpc({ repoRoot: REPO_ROOT, agent, selfMod, window })

  // Connect the agent in the background; the UI renders immediately and shows
  // connection state. A failed connect must surface, not crash boot.
  agent.connect().catch((err) => {
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
