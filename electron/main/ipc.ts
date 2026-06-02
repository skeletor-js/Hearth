// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { scaffoldMicroApp } from './micro-apps/scaffold.js'
import { startMicroApp, stopMicroApp } from './micro-apps/server.js'
import type { WorkspaceRegistry } from './workspaces/registry.js'
import type { SessionStore, TranscriptEntry } from './sessions/store.js'
import type { CreateSessionInput } from './sessions/store.js'
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile } from './fs/files.js'
import { TerminalManager } from './terminal/pty.js'
import type { BrowserManager, Rect } from './browser/browser-view.js'
import { SoulService, DEFAULT_SOUL, type SoulConfig } from './soul/soul.js'
import { mkdir, readFile as nodeReadFile, writeFile as nodeWriteFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
import { RunTracker } from './self-mod/run-tracker.js'
import { createOverlayClient } from './self-mod/overlay-client.js'
import { isViteTrackablePath } from './self-mod/path-relevance.js'
import { runTypecheck } from './self-mod/validate.js'
import { isSourceMutatingShell } from './self-mod/shell-guard.js'
import { relative, isAbsolute } from 'node:path'
import type { AgentHost } from './agents/agent-host.js'
import type { AgentKind, AuthState, BackendStatus, PermissionRequest } from '../shared/protocol.js'
import type { SecretStore } from './secrets/secret-store.js'
import { McpRegistry, type McpServerInput } from './mcp/registry.js'
import { probeServer } from './mcp/probe.js'
import { resolveAuth, apiKeyRefs } from './agents/auth-config.js'
import { listSkills, globalSkillsDir } from './skills/list.js'

let runSeq = 0

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
  secrets: SecretStore
  mcp: McpRegistry
}

export function registerIpc(services: MainServices): void {
  const { repoRoot, host, selfMod, workspaces, sessions, browser, window, secrets, mcp } = services

  // Self-mod run tracking (W0): attribute streamed writes to subagents, drive the
  // concurrency gate, and pin the overlay during parallel-subagent phases.
  const runTracker = new RunTracker()
  const overlay = createOverlayClient(() => process.env.ELECTRON_RENDERER_URL ?? null)
  const repoRel = (p: string): string => {
    const rel = isAbsolute(p) ? relative(repoRoot, p) : p
    return rel.replace(/\\/g, '/')
  }
  const broadcastActivity = (runId: string): void => {
    const a = runTracker.activity(runId)
    if (a) window.webContents.send(HEARTH_CHANNELS.selfModActivity, a)
  }

  // Stream agent updates to the renderer (forwarded from whichever backend is live),
  // and tap them for self-mod attribution + concurrency-gated overlay pinning.
  host.onUpdate((sessionId, update) => {
    window.webContents.send(HEARTH_CHANNELS.agentUpdate, { sessionId, update })
    const runId = runTracker.runForSession(sessionId)
    if (!runId) return
    if (update.type === 'tool-call') {
      // A tool-call that carries a parent is a subagent's own call; the lane is the
      // parent Task id. A top-level Task tool-call's own status updates close its lane.
      if (update.parentToolCallId) {
        runTracker.recordLane(runId, update.parentToolCallId, '', 'running')
      }
      runTracker.recordLane(runId, update.id, update.title, update.status)
      broadcastActivity(runId)
    } else if (update.type === 'diff') {
      const rel = repoRel(update.path)
      runTracker.recordWrite(runId, rel, {
        parentToolCallId: update.parentToolCallId ?? null,
        baseline: update.oldText,
      })
      // During a parallel-subagent phase, pin the pre-edit baseline so the live UI
      // stays coherent until the batch applies atomically at endRun.
      if (runTracker.isConcurrent(runId) && isViteTrackablePath(rel) && update.oldText != null) {
        void overlay.pin(rel, update.oldText)
      }
      broadcastActivity(runId)
    }
  })

  // Permission round-trip. A mid-turn ask blocks the agent until the renderer
  // answers, so we hold the resolver keyed by request id and complete it when
  // permission:respond comes back. Without this the agent hangs forever.
  const pendingPermissions = new Map<string, (optionId: string) => void>()
  host.onPermission(
    (sessionId, req) =>
      new Promise<string>((resolve) => {
        // Source-write enforcement (W0b): auto-reject shell that mutates repo
        // source so writes are forced onto the mediated Edit/Write path. Pick the
        // request's reject option without bothering the user.
        if (req.command && isSourceMutatingShell(req.command)) {
          const reject = req.options.find((o: PermissionRequest['options'][number]) => o.kind === 'reject')
          if (reject) return resolve(reject.id)
        }
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
      const key = payload.sessionId || 'default'
      // Recover an interrupted prior turn (crashed before captureTurn) before we
      // baseline — commits its orphaned changes as a `recovered` run, never lost.
      await selfMod.recoverIfIncomplete(key)
      // Snapshot what's already dirty BEFORE the turn so captureTurn commits only
      // what this turn changes — never the developer's pre-existing uncommitted work.
      const before = await selfMod.dirtyPaths()
      // Mint a run + write the in-progress marker, then prompt.
      const runId = `run-${++runSeq}-${Date.now()}`
      runTracker.beginRun(runId, key)
      selfMod.beginTurn()
      let result
      try {
        await host.prompt(payload.text, { key, cwd: payload.cwd || repoRoot })
      } finally {
        const ended = runTracker.endRun(runId)
        // Apply the overlay batch (no-op for unpinned paths / single-writer turns).
        void overlay.apply((ended?.groups ?? []).flatMap((g) => g.paths).filter(isViteTrackablePath))
        window.webContents.send(HEARTH_CHANNELS.selfModActivity, { runId, sessionId: key, lanes: [], collisions: [] })
        result = await selfMod.captureTurn(key, payload.text.slice(0, 72), before, ended ? { runId, groups: ended.groups } : undefined)
      }
      // W7: surface any writes the scope guard rejected (protected island / secrets)
      // so the user knows the agent's edit there was undone, not silently dropped.
      if (result?.rejectedPaths?.length) {
        window.webContents.send(HEARTH_CHANNELS.selfModValidation, {
          ok: false,
          output: `Blocked edits to protected/secret paths (restored, not committed):\n${result.rejectedPaths.join('\n')}`,
        })
      }
      // A restart-tier edit that failed the blocking typecheck (W6): surface it so
      // the crash surface offers Undo/Repair instead of bricking on restart.
      if (result?.blockedRestart) {
        window.webContents.send(HEARTH_CHANNELS.selfModValidation, { ok: false, output: result.blockedRestart.output })
      } else if (result && result.changedPaths.some((p) => isViteTrackablePath(p))) {
        // Async validation gate (W5): typecheck renderer edits without blocking the
        // turn; surface a failure for the crash surface / repair.
        void runTypecheck(repoRoot).then((tc) => {
          if (!tc.ok) window.webContents.send(HEARTH_CHANNELS.selfModValidation, tc)
        })
      }
      return result
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

  // Model select (per backend; exposed via ACP newSession + set_model).
  host.onModelsChanged((state) => window.webContents.send(HEARTH_CHANNELS.agentModelsChanged, state))
  ipcMain.handle(HEARTH_CHANNELS.agentGetModels, () => host.getModels())
  ipcMain.handle(HEARTH_CHANNELS.agentSetModel, (_e, modelId: string) => host.setModel(modelId))

  ipcMain.handle(HEARTH_CHANNELS.selfModHistory, () => selfMod.history())
  ipcMain.handle(HEARTH_CHANNELS.selfModUndo, (_e, hash: string) => selfMod.undo(hash))
  ipcMain.handle(HEARTH_CHANNELS.selfModRedo, (_e, hash: string) => selfMod.redo(hash))

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

  // Personality (soul) + memory. Personality is versioned in the repo
  // (.hearth/personality.json, committed as Hearth-Kind: soul) AND compiled into
  // each backend's native global instructions so the agent actually reads it.
  const soul = new SoulService()
  const personalityPath = join(repoRoot, '.hearth', 'personality.json')
  ipcMain.handle(HEARTH_CHANNELS.personalityGet, async (): Promise<SoulConfig> => {
    try {
      return { ...DEFAULT_SOUL, ...(JSON.parse(await nodeReadFile(personalityPath, 'utf8')) as Partial<SoulConfig>) }
    } catch {
      return DEFAULT_SOUL
    }
  })
  ipcMain.handle(HEARTH_CHANNELS.personalitySet, async (_e, config: SoulConfig) => {
    await mkdir(dirname(personalityPath), { recursive: true })
    await nodeWriteFile(personalityPath, JSON.stringify(config, null, 2) + '\n')
    await soul.setPersonality(config) // writes the managed block into Claude/Codex global files
    return selfMod.commitManaged(['.hearth/personality.json'], 'update personality', 'soul')
  })
  ipcMain.handle(HEARTH_CHANNELS.memoryGet, () => soul.getMemory())
  ipcMain.handle(HEARTH_CHANNELS.memoryClear, () => soul.setMemory(''))

  // Secrets: encrypted local store. The renderer sets/clears and lists names only;
  // values are read only by main (auth + MCP env resolution).
  ipcMain.handle(HEARTH_CHANNELS.secretsList, () => secrets.list())
  ipcMain.handle(HEARTH_CHANNELS.secretsSet, (_e, key: string, value: string) => secrets.set(key, value))
  ipcMain.handle(HEARTH_CHANNELS.secretsDelete, (_e, key: string) => secrets.delete(key))
  ipcMain.handle(HEARTH_CHANNELS.secretsEncryptionAvailable, () => secrets.encryptionAvailable)

  // Auth: truthful per-backend status + guided login. We render no OAuth and store
  // no subscription token (docs/COMPLIANCE.md) — login drops the user into a real
  // shell to run the CLI themselves; we only re-check status after.
  const authStatusFor = async (kind: AgentKind, reconnect: boolean): Promise<AuthState> => {
    const auth = resolveAuth(kind, secrets)
    const base: AuthState = {
      kind,
      mode: auth.mode,
      keySource: auth.mode === 'api-key' ? auth.source : undefined,
      connected: false,
      methods: [],
    }
    // Live connection state only applies to the active backend (the only one with
    // a spawned adapter). The inactive backend reports its credential mode only.
    if (kind !== host.kind) return base
    if (reconnect) {
      try {
        await host.reconnect()
      } catch {
        /* surfaced via the connect attempt below */
      }
    }
    try {
      await host.connect()
      return { ...base, connected: host.isConnected(), methods: host.authMethods() }
    } catch (err) {
      return { ...base, error: String(err instanceof Error ? err.message : err) }
    }
  }
  ipcMain.handle(HEARTH_CHANNELS.authStatus, (_e, kind: AgentKind, reconnect?: boolean) =>
    authStatusFor(kind, !!reconnect),
  )
  // The login command the user runs themselves (in Hearth's terminal or their own).
  ipcMain.handle(HEARTH_CHANNELS.authLogin, (_e, kind: AgentKind) => ({
    command: kind === 'codex' ? 'codex login' : 'claude login',
  }))
  ipcMain.handle(HEARTH_CHANNELS.authLogout, async (_e, kind: AgentKind) => {
    const auth = resolveAuth(kind, secrets)
    if (auth.mode === 'api-key' && auth.source === 'secret') {
      // Our stored key — we can actually clear it, then rebuild so the change takes.
      secrets.delete(apiKeyRefs(kind).secretKey)
      if (kind === host.kind) await host.reconnect().catch(() => {})
      window.webContents.send(HEARTH_CHANNELS.authChanged, await authStatusFor(kind, false))
      return { cleared: true }
    }
    // Subscription (or env key): the credential is the CLI's, not ours to delete —
    // hand back the command for the user to run.
    return { command: kind === 'codex' ? 'codex logout' : 'claude logout' }
  })

  // MCP servers the user adds (merged into each new ACP session).
  ipcMain.handle(HEARTH_CHANNELS.mcpList, () => mcp.list())
  ipcMain.handle(HEARTH_CHANNELS.mcpAdd, (_e, input: McpServerInput) => mcp.add(input))
  ipcMain.handle(HEARTH_CHANNELS.mcpUpdate, (_e, id: string, patch: Partial<McpServerInput>) => mcp.update(id, patch))
  ipcMain.handle(HEARTH_CHANNELS.mcpRemove, (_e, id: string) => mcp.remove(id))
  ipcMain.handle(HEARTH_CHANNELS.mcpSetEnabled, (_e, id: string, enabled: boolean) => mcp.setEnabled(id, enabled))
  ipcMain.handle(HEARTH_CHANNELS.mcpTest, async (_e, id: string) => {
    const cfg = mcp.get(id)
    if (!cfg) return { ok: false, error: 'Server not found' }
    return probeServer(cfg, secrets)
  })

  // Skills: read-only discovery (global + the active workspace).
  ipcMain.handle(HEARTH_CHANNELS.skillsList, (_e, cwd?: string) => ({
    skills: listSkills(cwd || repoRoot),
    commands: host.advertisedCommands(),
  }))
  ipcMain.handle(HEARTH_CHANNELS.skillsReveal, () => void shell.openPath(globalSkillsDir()))

  // Data & privacy: reveal the on-disk data folder backing the "stays on your
  // machine" claim.
  ipcMain.handle(HEARTH_CHANNELS.dataReveal, () => void shell.openPath(app.getPath('userData')))

  // About: app + adapter/SDK versions.
  ipcMain.handle(HEARTH_CHANNELS.aboutInfo, () => {
    const require = createRequire(import.meta.url)
    const ver = (pkg: string): string | null => {
      try {
        return (require(`${pkg}/package.json`) as { version?: string }).version ?? null
      } catch {
        return null
      }
    }
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      acpSdk: ver('@agentclientprotocol/sdk'),
      claudeAdapter: ver('@zed-industries/claude-agent-acp'),
      codexAdapter: ver('@agentclientprotocol/codex-acp'),
    }
  })

  // Double-clicking the title-bar strip zooms the window to fill the screen, and
  // again restores the previous frame (macOS "zoom"). maximize/unmaximize remembers
  // the prior bounds for us.
  ipcMain.on(HEARTH_CHANNELS.windowZoomToggle, () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

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
