// The contextBridge surface. The renderer sees exactly `window.hearth` and
// nothing else from Node/Electron. Keep this narrow — it is the trust boundary.

import { contextBridge, ipcRenderer } from 'electron'
import { HEARTH_CHANNELS as CH } from '../shared/channels.js'
import type { AgentKind, AgentUpdatePayload, BackendStatus, PermissionRequestPayload } from '../shared/protocol.js'
import type { DiffSummary } from '../main/self-mod/git-diff.js'
import type { BranchInfo, GitStatus, PrResult } from '../main/self-mod/git-ops.js'
import type { SelfModResult } from '../main/self-mod/self-mod-service.js'
import type { SelfModLogEntry } from '../main/self-mod/git.js'

const api = {
  agent: {
    prompt: (text: string): Promise<SelfModResult | null> => ipcRenderer.invoke(CH.agentPrompt, text),
    cancel: () => ipcRenderer.invoke(CH.agentCancel),
    getBackend: (): Promise<AgentKind> => ipcRenderer.invoke(CH.backendGet),
    setBackend: (kind: AgentKind): Promise<BackendStatus> => ipcRenderer.invoke(CH.backendSet, kind),
    onBackendChanged: (cb: (status: BackendStatus) => void) => {
      const handler = (_e: unknown, status: BackendStatus) => cb(status)
      ipcRenderer.on(CH.backendChanged, handler)
      return () => void ipcRenderer.off(CH.backendChanged, handler)
    },
    onUpdate: (cb: (payload: AgentUpdatePayload) => void) => {
      const handler = (_e: unknown, payload: AgentUpdatePayload) => cb(payload)
      ipcRenderer.on(CH.agentUpdate, handler)
      return () => void ipcRenderer.off(CH.agentUpdate, handler)
    },
    onError: (cb: (message: string) => void) => {
      const handler = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on(CH.agentError, handler)
      return () => void ipcRenderer.off(CH.agentError, handler)
    },
  },
  permission: {
    // Surface a mid-turn permission ask; the unsubscribe fn is returned.
    onRequest: (cb: (payload: PermissionRequestPayload) => void) => {
      const handler = (_e: unknown, payload: PermissionRequestPayload) => cb(payload)
      ipcRenderer.on(CH.permissionRequest, handler)
      return () => void ipcRenderer.off(CH.permissionRequest, handler)
    },
    // Answer it by option id; fire-and-forget (main holds the resolver).
    respond: (id: string, optionId: string) => ipcRenderer.send(CH.permissionRespond, { id, optionId }),
  },
  // Main asks the renderer to route somewhere before the agent's snapshot capture.
  view: {
    onNavigate: (cb: (payload: { path: string }) => void) => {
      const handler = (_e: unknown, payload: { path: string }) => cb(payload)
      ipcRenderer.on(CH.viewNavigate, handler)
      return () => void ipcRenderer.off(CH.viewNavigate, handler)
    },
  },
  selfMod: {
    history: (): Promise<SelfModLogEntry[]> => ipcRenderer.invoke(CH.selfModHistory),
    undo: (hash: string): Promise<SelfModResult> => ipcRenderer.invoke(CH.selfModUndo, hash),
  },
  git: {
    diff: (cwd?: string, rev?: string): Promise<DiffSummary> => ipcRenderer.invoke(CH.gitDiff, cwd, rev),
    status: (cwd?: string): Promise<GitStatus> => ipcRenderer.invoke(CH.gitStatus, cwd),
    stage: (paths: string[], cwd?: string): Promise<void> => ipcRenderer.invoke(CH.gitStage, paths, cwd),
    unstage: (paths: string[], cwd?: string): Promise<void> => ipcRenderer.invoke(CH.gitUnstage, paths, cwd),
    commit: (message: string, cwd?: string): Promise<string> => ipcRenderer.invoke(CH.gitCommit, message, cwd),
    branches: (cwd?: string): Promise<BranchInfo> => ipcRenderer.invoke(CH.gitBranches, cwd),
    switchBranch: (name: string, create: boolean, cwd?: string): Promise<void> =>
      ipcRenderer.invoke(CH.gitSwitchBranch, name, create, cwd),
    createPr: (title: string, body: string, cwd?: string): Promise<PrResult> =>
      ipcRenderer.invoke(CH.gitCreatePr, title, body, cwd),
  },
  microApps: {
    create: (name: string) => ipcRenderer.invoke(CH.microAppCreate, name),
    start: (name: string): Promise<string> => ipcRenderer.invoke(CH.microAppStart, name),
    stop: (name: string) => ipcRenderer.invoke(CH.microAppStop, name),
  },
}

contextBridge.exposeInMainWorld('hearth', api)

export type HearthApi = typeof api
