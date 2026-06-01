// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window.js'
import { registerIpc } from './ipc.js'
import { ClaudeAgent } from './agents/claude.js'
import { FakeAgent } from './agents/fake.js'
import type { Agent } from './agents/agent.js'
import { SelfModService } from './self-mod/self-mod-service.js'
import { HmrController } from './self-mod/hmr.js'
import { stopAllMicroApps } from './micro-apps/server.js'

// The repo is the agent's working directory — editing it IS self-modification.
// In dev that's the project root; in a packaged self-evolving build it's the
// app's writable copy of its own source (v2).
const REPO_ROOT = process.env.HEARTH_REPO_ROOT ?? process.cwd()

async function bootstrap(): Promise<void> {
  const window = createMainWindow()

  // HEARTH_FAKE_AGENT=1 swaps in a scripted agent for UI/permission development
  // without a live model. See agents/fake.ts.
  const agent: Agent = process.env.HEARTH_FAKE_AGENT
    ? new FakeAgent()
    : new ClaudeAgent({
        kind: 'claude',
        cwd: REPO_ROOT,
        // Default to the user's existing Claude Code login. Flip to
        // { mode: 'api-key', envVar: 'ANTHROPIC_API_KEY' } for BYO-key. See COMPLIANCE.md.
        auth: { mode: 'subscription' },
      })

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
