// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, ipcMain, type BrowserWindow } from 'electron'
import { scaffoldMicroApp } from './micro-apps/scaffold.js'
import { startMicroApp } from './micro-apps/server.js'
import { HEARTH_CHANNELS } from '../shared/channels.js'
import type { SelfModService } from './self-mod/self-mod-service.js'
import type { Agent } from './agents/agent.js'

export { HEARTH_CHANNELS }

export interface MainServices {
  repoRoot: string
  agent: Agent
  selfMod: SelfModService
  window: BrowserWindow
}

export function registerIpc(services: MainServices): void {
  const { repoRoot, agent, selfMod, window } = services

  // Stream agent updates to the renderer.
  agent.onUpdate((sessionId, update) => {
    window.webContents.send(HEARTH_CHANNELS.agentUpdate, { sessionId, update })
  })

  ipcMain.handle(HEARTH_CHANNELS.agentPrompt, async (_e, text: string) => {
    const session = await agent.newSession()
    await session.prompt(text)
    // After the turn, capture any self-edits the agent made.
    return selfMod.captureTurn(session.id, text.slice(0, 72))
  })

  ipcMain.handle(HEARTH_CHANNELS.selfModHistory, () => selfMod.history())
  ipcMain.handle(HEARTH_CHANNELS.selfModUndo, (_e, hash: string) => selfMod.undo(hash))

  ipcMain.handle(HEARTH_CHANNELS.microAppCreate, (_e, name: string) =>
    scaffoldMicroApp(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppStart, (_e, name: string) =>
    startMicroApp(repoRoot, name),
  )

  app.on('before-quit', () => {
    void agent.dispose()
  })
}
