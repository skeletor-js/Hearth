// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, ipcMain, type BrowserWindow } from 'electron'
import { scaffoldMicroApp } from './micro-apps/scaffold.js'
import { startMicroApp, stopMicroApp } from './micro-apps/server.js'
import { HEARTH_CHANNELS } from '../shared/channels.js'
import type { SelfModService } from './self-mod/self-mod-service.js'
import type { AgentHost } from './agents/agent-host.js'
import type { AgentKind, BackendStatus } from '../shared/protocol.js'

export { HEARTH_CHANNELS }

export interface MainServices {
  repoRoot: string
  /** The swappable backend host (Claude/Codex), stable across switches. */
  host: AgentHost
  selfMod: SelfModService
  window: BrowserWindow
}

export function registerIpc(services: MainServices): void {
  const { repoRoot, host, selfMod, window } = services

  // Stream agent updates to the renderer (forwarded from whichever backend is live).
  host.onUpdate((sessionId, update) => {
    window.webContents.send(HEARTH_CHANNELS.agentUpdate, { sessionId, update })
  })

  // Permission round-trip. A mid-turn ask blocks the agent until the renderer
  // answers, so we hold the resolver keyed by request id and complete it when
  // permission:respond comes back. Without this the agent hangs forever.
  const pendingPermissions = new Map<string, (optionId: string) => void>()
  host.onPermission(
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

  ipcMain.handle(HEARTH_CHANNELS.agentPrompt, async (_e, text: string) => {
    const sessionId = await host.prompt(text)
    // After the turn, capture any self-edits the agent made.
    return selfMod.captureTurn(sessionId, text.slice(0, 72))
  })
  ipcMain.handle(HEARTH_CHANNELS.agentCancel, () => host.cancel())

  // Backend switcher.
  ipcMain.handle(HEARTH_CHANNELS.backendGet, (): AgentKind => host.kind)
  ipcMain.handle(HEARTH_CHANNELS.backendSet, async (_e, kind: AgentKind): Promise<BackendStatus> => {
    try {
      await host.switchTo(kind)
      const status: BackendStatus = { kind: host.kind }
      window.webContents.send(HEARTH_CHANNELS.backendChanged, status)
      return status
    } catch (err) {
      const status: BackendStatus = { kind: host.kind, error: String(err instanceof Error ? err.message : err) }
      window.webContents.send(HEARTH_CHANNELS.backendChanged, status)
      return status
    }
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
    void host.dispose()
  })
}
