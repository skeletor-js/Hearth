// The contextBridge surface. The renderer sees exactly `window.hearth` and
// nothing else from Node/Electron. Keep this narrow — it is the trust boundary.

import { contextBridge, ipcRenderer } from 'electron'
import { HEARTH_CHANNELS as CH } from '../shared/channels.js'
import type { AgentKind, AgentUpdatePayload, BackendStatus, ModelState, PermissionRequestPayload } from '../shared/protocol.js'
import type { DiffSummary } from '../main/self-mod/git-diff.js'
import type { BranchInfo, GitStatus, PrResult } from '../main/self-mod/git-ops.js'
import type { SelfModResult, StepResult } from '../main/self-mod/self-mod-service.js'
import type { SelfModLogEntry } from '../main/self-mod/git.js'
import type { RunActivity } from '../main/self-mod/run-tracker.js'
import type { TypecheckResult } from '../main/self-mod/validate.js'
import type { Workspace } from '../main/workspaces/registry.js'
import type { FileContent, FileEntry } from '../main/fs/files.js'
import type { BrowserState } from '../main/browser/browser-view.js'
import type { SoulConfig } from '../main/soul/soul.js'
import type { CreateSessionInput, SessionDetail, SessionMeta, TranscriptEntry } from '../main/sessions/store.js'

interface WorkspaceStatus {
  branch: string | null
  dirty: number
  ahead: number
  behind: number
}

const api = {
  agent: {
    prompt: (sessionId: string, cwd: string, text: string): Promise<SelfModResult | null> =>
      ipcRenderer.invoke(CH.agentPrompt, { sessionId, cwd, text }),
    cancel: () => ipcRenderer.invoke(CH.agentCancel),
    getBackend: (): Promise<AgentKind> => ipcRenderer.invoke(CH.backendGet),
    setBackend: (kind: AgentKind): Promise<BackendStatus> => ipcRenderer.invoke(CH.backendSet, kind),
    getModels: (): Promise<ModelState> => ipcRenderer.invoke(CH.agentGetModels),
    setModel: (modelId: string): Promise<void> => ipcRenderer.invoke(CH.agentSetModel, modelId),
    onModelsChanged: (cb: (state: ModelState) => void) => {
      const handler = (_e: unknown, state: ModelState) => cb(state)
      ipcRenderer.on(CH.agentModelsChanged, handler)
      return () => void ipcRenderer.off(CH.agentModelsChanged, handler)
    },
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
    undo: (hash: string): Promise<StepResult> => ipcRenderer.invoke(CH.selfModUndo, hash),
    redo: (hash: string): Promise<StepResult> => ipcRenderer.invoke(CH.selfModRedo, hash),
    // Live subagent activity for the Agents panel (W4).
    onActivity: (cb: (activity: RunActivity) => void) => {
      const h = (_e: unknown, a: RunActivity) => cb(a)
      ipcRenderer.on(CH.selfModActivity, h)
      return () => void ipcRenderer.off(CH.selfModActivity, h)
    },
    // Post-edit typecheck failures (W5/W6) — drives the crash/repair surface.
    onValidation: (cb: (result: TypecheckResult) => void) => {
      const h = (_e: unknown, r: TypecheckResult) => cb(r)
      ipcRenderer.on(CH.selfModValidation, h)
      return () => void ipcRenderer.off(CH.selfModValidation, h)
    },
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
  workspaces: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke(CH.workspacesList),
    open: (): Promise<Workspace | null> => ipcRenderer.invoke(CH.workspacesOpen),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(CH.workspacesRemove, id),
    status: (path: string): Promise<WorkspaceStatus> => ipcRenderer.invoke(CH.workspacesStatus, path),
  },
  sessions: {
    list: (): Promise<SessionMeta[]> => ipcRenderer.invoke(CH.sessionsList),
    create: (input: CreateSessionInput): Promise<SessionMeta> => ipcRenderer.invoke(CH.sessionsCreate, input),
    get: (id: string): Promise<SessionDetail | null> => ipcRenderer.invoke(CH.sessionsGet, id),
    append: (id: string, entries: TranscriptEntry[]): Promise<void> => ipcRenderer.invoke(CH.sessionsAppend, id, entries),
    rename: (id: string, title: string): Promise<SessionMeta | null> => ipcRenderer.invoke(CH.sessionsRename, id, title),
    archive: (id: string): Promise<void> => ipcRenderer.invoke(CH.sessionsArchive, id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(CH.sessionsDelete, id),
    duplicate: (id: string): Promise<SessionMeta | null> => ipcRenderer.invoke(CH.sessionsDuplicate, id),
  },
  terminal: {
    create: (id: string, cwd: string | undefined, cols: number, rows: number) =>
      ipcRenderer.send(CH.terminalCreate, { id, cwd, cols, rows }),
    write: (id: string, data: string) => ipcRenderer.send(CH.terminalWrite, { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(CH.terminalResize, { id, cols, rows }),
    kill: (id: string) => ipcRenderer.send(CH.terminalKill, { id }),
    onData: (cb: (id: string, data: string) => void) => {
      const h = (_e: unknown, p: { id: string; data: string }) => cb(p.id, p.data)
      ipcRenderer.on(CH.terminalData, h)
      return () => void ipcRenderer.off(CH.terminalData, h)
    },
    onExit: (cb: (id: string) => void) => {
      const h = (_e: unknown, p: { id: string }) => cb(p.id)
      ipcRenderer.on(CH.terminalExit, h)
      return () => void ipcRenderer.off(CH.terminalExit, h)
    },
  },
  files: {
    list: (cwd: string | undefined, rel?: string): Promise<FileEntry[]> => ipcRenderer.invoke(CH.fsList, cwd, rel),
    read: (cwd: string | undefined, rel: string): Promise<FileContent> => ipcRenderer.invoke(CH.fsRead, cwd, rel),
    write: (cwd: string | undefined, rel: string, content: string): Promise<void> =>
      ipcRenderer.invoke(CH.fsWrite, cwd, rel, content),
  },
  browser: {
    open: (workspaceId: string | undefined, fallback: string) => ipcRenderer.send(CH.browserOpen, { workspaceId, fallback }),
    navigate: (url: string, workspaceId?: string) => ipcRenderer.send(CH.browserNavigate, { url, workspaceId }),
    back: () => ipcRenderer.send(CH.browserBack),
    forward: () => ipcRenderer.send(CH.browserForward),
    reload: () => ipcRenderer.send(CH.browserReload),
    setBounds: (rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send(CH.browserSetBounds, rect),
    hide: () => ipcRenderer.send(CH.browserHide),
    onState: (cb: (state: BrowserState) => void) => {
      const h = (_e: unknown, state: BrowserState) => cb(state)
      ipcRenderer.on(CH.browserState, h)
      return () => void ipcRenderer.off(CH.browserState, h)
    },
  },
  personality: {
    get: (): Promise<SoulConfig> => ipcRenderer.invoke(CH.personalityGet),
    set: (config: SoulConfig): Promise<{ commit: string; changedPaths: string[] }> => ipcRenderer.invoke(CH.personalitySet, config),
  },
  memory: {
    get: (): Promise<string> => ipcRenderer.invoke(CH.memoryGet),
  },
  win: {
    /** Toggle the window between filling the screen and its previous frame. */
    zoomToggle: () => ipcRenderer.send(CH.windowZoomToggle),
  },
  microApps: {
    create: (name: string) => ipcRenderer.invoke(CH.microAppCreate, name),
    start: (name: string): Promise<string> => ipcRenderer.invoke(CH.microAppStart, name),
    stop: (name: string) => ipcRenderer.invoke(CH.microAppStop, name),
  },
}

contextBridge.exposeInMainWorld('hearth', api)

export type HearthApi = typeof api
