// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, ipcMain, type BrowserWindow } from 'electron'
import { scaffoldMicroApp } from './micro-apps/scaffold.js'
import { startMicroApp, stopMicroApp } from './micro-apps/server.js'
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

  // Permission round-trip. A mid-turn ask blocks the agent until the renderer
  // answers, so we hold the resolver keyed by request id and complete it when
  // permission:respond comes back. Without this the agent hangs forever.
  const pendingPermissions = new Map<string, (optionId: string) => void>()
  agent.onPermission(
    (sessionId, req) =>
      new Promise<string>((resolve) => {
        pendingPermissions.set(req.id, resolve)
        window.webContents.send(HEARTH_CHANNELS.permissionRequest, { sessionId, req })
      }),
  )
  ipcMain.on(HEARTH_CHANNELS.permissionRespond, (_e, payload: { id: string; optionId: string }) => {
    const resolve = pendingPermissions.get(payload.id)
    if (resolve) {
      pendingPermissions.delete(payload.id)
      resolve(payload.optionId)
    }
  })

  // One session per window, created lazily on first prompt and reused — so a
  // turn's context persists and `cancel` has something to target.
  let session: Awaited<ReturnType<Agent['newSession']>> | null = null
  const getSession = async () => (session ??= await agent.newSession())

  ipcMain.handle(HEARTH_CHANNELS.agentPrompt, async (_e, text: string) => {
    const s = await getSession()
    await s.prompt(text)
    // After the turn, capture any self-edits the agent made.
    return selfMod.captureTurn(s.id, text.slice(0, 72))
  })
  ipcMain.handle(HEARTH_CHANNELS.agentCancel, async () => {
    await session?.cancel()
  })

  ipcMain.handle(HEARTH_CHANNELS.selfModHistory, () => selfMod.history())
  ipcMain.handle(HEARTH_CHANNELS.selfModUndo, (_e, hash: string) => selfMod.undo(hash))

  ipcMain.handle(HEARTH_CHANNELS.microAppCreate, (_e, name: string) =>
    scaffoldMicroApp(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppStart, (_e, name: string) =>
    startMicroApp(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppStop, (_e, name: string) => stopMicroApp(name))

  app.on('before-quit', () => {
    void agent.dispose()
  })
}
