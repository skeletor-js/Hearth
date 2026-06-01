// The contextBridge surface. The renderer sees exactly `window.hearth` and
// nothing else from Node/Electron. Keep this narrow — it is the trust boundary.

import { contextBridge, ipcRenderer } from 'electron'
import { HEARTH_CHANNELS as CH } from '../shared/channels.js'

const api = {
  agent: {
    prompt: (text: string) => ipcRenderer.invoke(CH.agentPrompt, text),
    cancel: (sessionId: string) => ipcRenderer.invoke(CH.agentCancel, sessionId),
    onUpdate: (cb: (payload: unknown) => void) => {
      const handler = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on(CH.agentUpdate, handler)
      return () => ipcRenderer.off(CH.agentUpdate, handler)
    },
    onError: (cb: (message: string) => void) => {
      const handler = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on(CH.agentError, handler)
      return () => ipcRenderer.off(CH.agentError, handler)
    },
  },
  selfMod: {
    history: () => ipcRenderer.invoke(CH.selfModHistory),
    undo: (hash: string) => ipcRenderer.invoke(CH.selfModUndo, hash),
  },
  microApps: {
    create: (name: string) => ipcRenderer.invoke(CH.microAppCreate, name),
    start: (name: string) => ipcRenderer.invoke(CH.microAppStart, name),
  },
}

contextBridge.exposeInMainWorld('hearth', api)

export type HearthApi = typeof api
