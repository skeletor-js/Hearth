// The contextBridge surface. The renderer sees exactly `window.hearth` and
// nothing else from Node/Electron. Keep this narrow — it is the trust boundary.

import { contextBridge, ipcRenderer } from 'electron'
import { HEARTH_CHANNELS as CH } from '../shared/channels.js'
import type { AgentUpdatePayload, PermissionRequestPayload } from '../shared/protocol.js'

const api = {
  agent: {
    prompt: (text: string) => ipcRenderer.invoke(CH.agentPrompt, text),
    cancel: () => ipcRenderer.invoke(CH.agentCancel),
    onUpdate: (cb: (payload: AgentUpdatePayload) => void) => {
      const handler = (_e: unknown, payload: AgentUpdatePayload) => cb(payload)
      ipcRenderer.on(CH.agentUpdate, handler)
      return () => ipcRenderer.off(CH.agentUpdate, handler)
    },
    onError: (cb: (message: string) => void) => {
      const handler = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on(CH.agentError, handler)
      return () => ipcRenderer.off(CH.agentError, handler)
    },
  },
  permission: {
    // Surface a mid-turn permission ask; the unsubscribe fn is returned.
    onRequest: (cb: (payload: PermissionRequestPayload) => void) => {
      const handler = (_e: unknown, payload: PermissionRequestPayload) => cb(payload)
      ipcRenderer.on(CH.permissionRequest, handler)
      return () => ipcRenderer.off(CH.permissionRequest, handler)
    },
    // Answer it by option id; fire-and-forget (main holds the resolver).
    respond: (id: string, optionId: string) => ipcRenderer.send(CH.permissionRespond, { id, optionId }),
  },
  selfMod: {
    history: () => ipcRenderer.invoke(CH.selfModHistory),
    undo: (hash: string) => ipcRenderer.invoke(CH.selfModUndo, hash),
  },
  microApps: {
    create: (name: string) => ipcRenderer.invoke(CH.microAppCreate, name),
    start: (name: string): Promise<string> => ipcRenderer.invoke(CH.microAppStart, name),
    stop: (name: string) => ipcRenderer.invoke(CH.microAppStop, name),
  },
}

contextBridge.exposeInMainWorld('hearth', api)

export type HearthApi = typeof api
