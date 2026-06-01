// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { scaffoldMicroApp } from './micro-apps/scaffold.js'
import { startMicroApp, stopMicroApp } from './micro-apps/server.js'
import type { WorkspaceRegistry } from './workspaces/registry.js'
import type { SessionStore, TranscriptEntry } from './sessions/store.js'
import type { CreateSessionInput } from './sessions/store.js'
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile } from './fs/files.js'
import { TerminalManager } from './terminal/pty.js'
import type { BrowserManager, Rect } from './browser/browser-view.js'
import { getDiff } from './self-mod/git-diff.js'
import {
  branches as gitBranches,
  commit as gitCommit,
  createPr as gitCreatePr,
  stage as gitStage,
  status as gitStatus,
  switchBranch as gitSwitchBranch,
  unstage as gitUnstage,
} from './self-mod/git-ops.js'
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
  workspaces: WorkspaceRegistry
  sessions: SessionStore
  browser: BrowserManager
  window: BrowserWindow
}

export function registerIpc(services: MainServices): void {
  const { repoRoot, host, selfMod, workspaces, sessions, browser, window } = services

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

  ipcMain.handle(
    HEARTH_CHANNELS.agentPrompt,
    async (_e, payload: { sessionId: string; cwd?: string; text: string }) => {
      // Snapshot what's already dirty BEFORE the turn so captureTurn commits only
      // what this turn changes — never the developer's pre-existing uncommitted work.
      // captureTurn ALWAYS targets REPO_ROOT: editing another workspace's cwd never
      // produces a self-mod commit (no HMR), but a Hearth-source edit from ANY
      // session does. The per-session cwd only sets where the agent writes.
      const before = await selfMod.dirtyPaths()
      const key = payload.sessionId || 'default'
      await host.prompt(payload.text, { key, cwd: payload.cwd || repoRoot })
      return selfMod.captureTurn(key, payload.text.slice(0, 72), before)
    },
  )
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

  // Workbench git surface. `cwd` defaults to the Hearth repo until workspaces
  // (P3) thread a real per-session cwd.
  const at = (cwd?: string) => cwd || repoRoot
  ipcMain.handle(HEARTH_CHANNELS.gitDiff, (_e, cwd?: string, rev?: string) => getDiff(at(cwd), rev))
  ipcMain.handle(HEARTH_CHANNELS.gitStatus, (_e, cwd?: string) => gitStatus(at(cwd)))
  ipcMain.handle(HEARTH_CHANNELS.gitStage, (_e, paths: string[], cwd?: string) => gitStage(at(cwd), paths))
  ipcMain.handle(HEARTH_CHANNELS.gitUnstage, (_e, paths: string[], cwd?: string) => gitUnstage(at(cwd), paths))
  ipcMain.handle(HEARTH_CHANNELS.gitCommit, (_e, message: string, cwd?: string) => gitCommit(at(cwd), message))
  ipcMain.handle(HEARTH_CHANNELS.gitBranches, (_e, cwd?: string) => gitBranches(at(cwd)))
  ipcMain.handle(HEARTH_CHANNELS.gitSwitchBranch, (_e, name: string, create: boolean, cwd?: string) =>
    gitSwitchBranch(at(cwd), name, create),
  )
  ipcMain.handle(HEARTH_CHANNELS.gitCreatePr, (_e, title: string, body: string, cwd?: string) =>
    gitCreatePr(at(cwd), title, body),
  )

  // Workspaces. `open` shows the folder picker (a UI affordance the user invokes,
  // so the dialog is appropriate here) and registers the chosen folder.
  ipcMain.handle(HEARTH_CHANNELS.workspacesList, () => workspaces.list())
  ipcMain.handle(HEARTH_CHANNELS.workspacesOpen, async () => {
    const res = await dialog.showOpenDialog(window, {
      title: 'Open a workspace folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return workspaces.add(res.filePaths[0])
  })
  ipcMain.handle(HEARTH_CHANNELS.workspacesRemove, (_e, id: string) => workspaces.remove(id))
  ipcMain.handle(HEARTH_CHANNELS.workspacesStatus, async (_e, path: string) => {
    try {
      const s = await gitStatus(path)
      return { branch: s.branch, dirty: s.files.length, ahead: s.ahead, behind: s.behind }
    } catch {
      return { branch: null, dirty: 0, ahead: 0, behind: 0 }
    }
  })

  // Sessions.
  ipcMain.handle(HEARTH_CHANNELS.sessionsList, () => sessions.list())
  ipcMain.handle(HEARTH_CHANNELS.sessionsCreate, (_e, input: CreateSessionInput) => sessions.create(input))
  ipcMain.handle(HEARTH_CHANNELS.sessionsGet, (_e, id: string) => sessions.get(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsAppend, (_e, id: string, entries: TranscriptEntry[]) => sessions.append(id, entries))
  ipcMain.handle(HEARTH_CHANNELS.sessionsRename, (_e, id: string, title: string) => sessions.rename(id, title))
  ipcMain.handle(HEARTH_CHANNELS.sessionsArchive, (_e, id: string) => sessions.archive(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsDelete, (_e, id: string) => sessions.remove(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsDuplicate, (_e, id: string) => sessions.duplicate(id))

  // Terminal: a real PTY per panel. Output streams to the renderer keyed by id.
  const terminals = new TerminalManager(
    (id, data) => window.webContents.send(HEARTH_CHANNELS.terminalData, { id, data }),
    (id) => window.webContents.send(HEARTH_CHANNELS.terminalExit, { id }),
  )
  ipcMain.on(HEARTH_CHANNELS.terminalCreate, (_e, p: { id: string; cwd?: string; cols?: number; rows?: number }) =>
    terminals.create(p.id, p.cwd || repoRoot, p.cols, p.rows),
  )
  ipcMain.on(HEARTH_CHANNELS.terminalWrite, (_e, p: { id: string; data: string }) => terminals.write(p.id, p.data))
  ipcMain.on(HEARTH_CHANNELS.terminalResize, (_e, p: { id: string; cols: number; rows: number }) =>
    terminals.resize(p.id, p.cols, p.rows),
  )
  ipcMain.on(HEARTH_CHANNELS.terminalKill, (_e, p: { id: string }) => terminals.kill(p.id))

  // Browser (embedded WebContentsView). The renderer reports the content-area rect.
  ipcMain.on(HEARTH_CHANNELS.browserOpen, (_e, p: { workspaceId?: string; fallback: string }) =>
    browser.open(p.workspaceId, p.fallback),
  )
  ipcMain.on(HEARTH_CHANNELS.browserNavigate, (_e, p: { url: string; workspaceId?: string }) =>
    browser.navigate(p.url, p.workspaceId),
  )
  ipcMain.on(HEARTH_CHANNELS.browserBack, () => browser.back())
  ipcMain.on(HEARTH_CHANNELS.browserForward, () => browser.forward())
  ipcMain.on(HEARTH_CHANNELS.browserReload, () => browser.reload())
  ipcMain.on(HEARTH_CHANNELS.browserSetBounds, (_e, rect: Rect) => browser.setBounds(rect))
  ipcMain.on(HEARTH_CHANNELS.browserHide, () => browser.hide())

  // Files (workspace-rooted; cwd defaults to the Hearth repo).
  ipcMain.handle(HEARTH_CHANNELS.fsList, (_e, cwd: string | undefined, rel?: string) => listDir(cwd || repoRoot, rel))
  ipcMain.handle(HEARTH_CHANNELS.fsRead, (_e, cwd: string | undefined, rel: string) => fsReadFile(cwd || repoRoot, rel))
  ipcMain.handle(HEARTH_CHANNELS.fsWrite, (_e, cwd: string | undefined, rel: string, content: string) =>
    fsWriteFile(cwd || repoRoot, rel, content),
  )

  ipcMain.handle(HEARTH_CHANNELS.microAppCreate, (_e, name: string) =>
    scaffoldMicroApp(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppStart, (_e, name: string) =>
    startMicroApp(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppStop, (_e, name: string) => stopMicroApp(name))

  app.on('before-quit', () => {
    terminals.disposeAll()
    void host.dispose()
  })
}
