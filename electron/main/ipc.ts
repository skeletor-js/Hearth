// The single IPC surface between renderer and main. Every channel is explicit.
// Channel names are shared with the preload bridge via the HEARTH_CHANNELS map
// so the two can't drift.

import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { scaffoldMicroApp, listStarters } from './micro-apps/scaffold.js'
import { startMicroApp, stopMicroApp, listMicroApps } from './micro-apps/server.js'
import type { CapabilityStore } from './micro-apps/capabilities.js'
import type { CredentialBroker } from './micro-apps/broker.js'
import type { WorkspaceRegistry } from './workspaces/registry.js'
import type { SessionStore, TranscriptEntry } from './sessions/store.js'
import type { CreateSessionInput } from './sessions/store.js'
import type { RoutineStore } from './routines/store.js'
import type { RoutineScheduler } from './routines/scheduler.js'
import type { Updater } from './updater.js'
import type { CreateRoutineInput } from '../shared/protocol.js'
import { listDir, readFile as fsReadFile, writeFileGuarded } from './fs/files.js'
import { TerminalManager } from './terminal/pty.js'
import type { BrowserManager, Rect } from './browser/browser-view.js'
import { SoulService, DEFAULT_SOUL, type SoulConfig } from './soul/soul.js'
import { mkdir, readFile as nodeReadFile, writeFile as nodeWriteFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
import { TurnCoordinator } from './turn-coordinator.js'
import { relative, isAbsolute } from 'node:path'
import type { AgentHost } from './agents/agent-host.js'
import type { AgentKind, AuthState, BackendStatus, PermissionRequest, WorkspaceKind } from '../shared/protocol.js'
import type { SecretStore } from './secrets/secret-store.js'
import { McpRegistry, type McpServerInput } from './mcp/registry.js'
import { probeServer } from './mcp/probe.js'
import { readActiveConnectors } from './mcp/active-connectors.js'
import { resolveAuth, apiKeyRefs } from './agents/auth-config.js'
import { hasStoredLogin } from './agents/login-presence.js'
import { listSkills, globalSkillsDir, setSkillEnabled } from './skills/list.js'

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
  capabilities: CapabilityStore
  broker: CredentialBroker
  routines: RoutineStore
  scheduler: RoutineScheduler
  updater: Updater
}

export function registerIpc(services: MainServices): void {
  const { repoRoot, host, selfMod, workspaces, sessions, browser, window, secrets, mcp, capabilities, broker, routines, scheduler, updater } = services

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
    // sessionId is already the renderer session key (the host translates from the
    // ACP id), so it matches both the renderer's session and the run tracker's runs.
    window.webContents.send(HEARTH_CHANNELS.agentUpdate, { sessionId, update })
    const runId = runTracker.runForSession(sessionId)
    if (!runId) return
    if (update.type === 'tool-call') {
      // A tool-call that carries a parent marks that parent as a subagent (a Task) —
      // that's what surfaces in the Agents panel + drives the W1 concurrency gate. We
      // record every tool-call so the parent Task's own title/status are captured
      // regardless of arrival order; only subagent-marked ones are surfaced.
      if (update.parentToolCallId) runTracker.markSubagent(runId, update.parentToolCallId)
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
  // permission:respond comes back. Without this the agent hangs forever. The
  // session key rides along so an adapter death can settle the right asks (U5).
  const pendingPermissions = new Map<string, { sessionId: string; resolve: (optionId: string) => void; reject: (err: Error) => void }>()
  host.onPermission(
    (sessionId, req) =>
      new Promise<string>((resolve, reject) => {
        // Source-write enforcement (W0b): auto-reject shell that mutates repo
        // source so writes are forced onto the mediated Edit/Write path. Pick the
        // request's reject option without bothering the user.
        if (req.command && isSourceMutatingShell(req.command)) {
          const rejectOpt = req.options.find((o: PermissionRequest['options'][number]) => o.kind === 'reject')
          if (rejectOpt) return resolve(rejectOpt.id)
        }
        pendingPermissions.set(req.id, { sessionId, resolve, reject })
        // sessionId is already the renderer session key (translated by the host), so
        // the renderer routes the ask (and its presence "waiting" state) correctly.
        window.webContents.send(HEARTH_CHANNELS.permissionRequest, { sessionId, req })
      }),
  )
  ipcMain.on(HEARTH_CHANNELS.permissionRespond, (_e, payload: { id: string; optionId: string }) => {
    const pending = pendingPermissions.get(payload.id)
    if (pending) {
      pendingPermissions.delete(payload.id)
      pending.resolve(payload.optionId)
    }
  })

  // Adapter death (U5): settle every permission still waiting on the dead
  // process (the rejection flows back as a 'cancelled' outcome — no resolver
  // leak, no hung agent promise) and surface an error ATTRIBUTED to the
  // session(s) whose turns were in flight, so a background/routine failure
  // doesn't land on whatever session happens to be foreground.
  host.onAgentExit((sessionKeys, message) => {
    for (const [id, pending] of [...pendingPermissions]) {
      pendingPermissions.delete(id)
      pending.reject(new Error(message))
    }
    const targets: Array<string | null> = sessionKeys.length ? sessionKeys : [null]
    for (const sessionKey of targets) {
      window.webContents.send(HEARTH_CHANNELS.agentError, { sessionKey, message })
    }
  })

  // The turn lifecycle (recover → baseline → prompt → capture, with per-cwd
  // serialization) lives in TurnCoordinator (U13) — unit-tested without
  // Electron. This handler is pure transport.
  const turns = new TurnCoordinator({
    repoRoot,
    host,
    selfMod,
    sessions,
    runTracker,
    overlay,
    send: (channel, payload) => window.webContents.send(channel, payload),
    typecheck: runTypecheck,
  })
  ipcMain.handle(
    HEARTH_CHANNELS.agentPrompt,
    (_e, payload: { sessionId: string; cwd?: string; text: string; images?: import('../shared/protocol.js').PromptImage[] }) =>
      turns.runTurn(payload),
  )
  ipcMain.handle(HEARTH_CHANNELS.agentCancel, (_e, sessionId?: string) => host.cancel(sessionId))

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

  // Permission mode, generic config options, and usage — one path for both backends
  // (ACP set_mode / set_config_option + current_mode_update / config_option_update /
  // usage_update). See ACP-SESSION-SURFACE-PLAN Phase 1B.
  host.onModeChanged((state) => window.webContents.send(HEARTH_CHANNELS.agentModeChanged, state))
  ipcMain.handle(HEARTH_CHANNELS.agentGetModes, () => host.getModes())
  ipcMain.handle(HEARTH_CHANNELS.agentSetMode, (_e, modeId: string) => host.setMode(modeId))
  host.onConfigChanged((options) => window.webContents.send(HEARTH_CHANNELS.agentConfigChanged, options))
  ipcMain.handle(HEARTH_CHANNELS.agentGetConfig, () => host.getConfigOptions())
  ipcMain.handle(HEARTH_CHANNELS.agentSetConfig, (_e, configId: string, value: string | boolean) =>
    host.setConfigOption(configId, value),
  )
  host.onUsageChanged((usage) => window.webContents.send(HEARTH_CHANNELS.agentUsageChanged, usage))
  ipcMain.handle(HEARTH_CHANNELS.agentGetUsage, () => host.getUsage())

  // Prompt capabilities (image / embedded context) + advertised slash commands.
  // W1 gates composer attachments on the former; W6 surfaces the latter in the
  // composer, updating live on available_commands_update.
  ipcMain.handle(HEARTH_CHANNELS.agentPromptCaps, () => host.promptCapabilities())
  ipcMain.handle(HEARTH_CHANNELS.agentGetCommands, () => host.advertisedCommands())
  host.onCommandsChanged((commands) => window.webContents.send(HEARTH_CHANNELS.agentCommandsChanged, commands))

  ipcMain.handle(HEARTH_CHANNELS.selfModHistory, () => selfMod.history())
  // Plain undo/redo: let Vite's autonomous reloads apply the revert. They self-heal
  // through the transient broken state a revert creates (a file is deleted while a
  // sibling still imports it for a beat), retrying until the files settle. Morph-
  // covering undo was attempted and reverted: suppressing those autonomous reloads
  // to force one explicit covered reload landed in that broken window and left the
  // renderer blank. Covering undo seamlessly needs revert-settle handling — deferred.
  ipcMain.handle(HEARTH_CHANNELS.selfModUndo, (_e, hash: string) => selfMod.undo(hash))
  ipcMain.handle(HEARTH_CHANNELS.selfModRedo, (_e, hash: string) => selfMod.redo(hash))

  // Workbench git surface. `cwd` is resolved against the registered workspaces:
  // an absent cwd defaults to the Hearth repo, and a cwd that isn't inside a known
  // workspace is rejected so a compromised renderer can't run git in an arbitrary
  // directory.
  const at = async (cwd?: string): Promise<string> => {
    if (!cwd) return repoRoot
    if (await workspaces.contains(cwd)) return cwd
    throw new Error(`cwd is not a registered workspace: ${cwd}`)
  }
  ipcMain.handle(HEARTH_CHANNELS.gitDiff, async (_e, cwd?: string, rev?: string) => getDiff(await at(cwd), rev))
  ipcMain.handle(HEARTH_CHANNELS.gitStatus, async (_e, cwd?: string) => gitStatus(await at(cwd)))
  ipcMain.handle(HEARTH_CHANNELS.gitStage, async (_e, paths: string[], cwd?: string) => gitStage(await at(cwd), paths))
  ipcMain.handle(HEARTH_CHANNELS.gitUnstage, async (_e, paths: string[], cwd?: string) => gitUnstage(await at(cwd), paths))
  ipcMain.handle(HEARTH_CHANNELS.gitCommit, async (_e, message: string, cwd?: string) => gitCommit(await at(cwd), message))
  ipcMain.handle(HEARTH_CHANNELS.gitBranches, async (_e, cwd?: string) => gitBranches(await at(cwd)))
  ipcMain.handle(HEARTH_CHANNELS.gitSwitchBranch, async (_e, name: string, create: boolean, cwd?: string) =>
    gitSwitchBranch(await at(cwd), name, create),
  )
  ipcMain.handle(HEARTH_CHANNELS.gitCreatePr, async (_e, title: string, body: string, cwd?: string) =>
    gitCreatePr(await at(cwd), title, body),
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
  ipcMain.handle(HEARTH_CHANNELS.sessionsSearch, (_e, query: string) => sessions.search(query))
  ipcMain.handle(HEARTH_CHANNELS.sessionsCreate, (_e, input: CreateSessionInput) => {
    // Infer the workspace framing when the caller doesn't specify it: Hearth and
    // any git repo get the developer workbench; a plain folder gets the
    // knowledge-worker surfaces. The user can still flip it per session.
    const kind = input.kind ?? (input.self || existsSync(join(input.cwd, '.git')) ? 'code' : 'knowledge')
    return sessions.create({ ...input, kind })
  })
  ipcMain.handle(HEARTH_CHANNELS.sessionsGet, (_e, id: string) => sessions.get(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsAppend, (_e, id: string, entries: TranscriptEntry[]) => sessions.append(id, entries))
  ipcMain.handle(HEARTH_CHANNELS.sessionsRename, (_e, id: string, title: string) => sessions.rename(id, title))
  ipcMain.handle(HEARTH_CHANNELS.sessionsSetKind, (_e, id: string, kind: WorkspaceKind) => sessions.setKind(id, kind))

  // Routines: CRUD on definitions + a manual fire. The schedule timer (started in
  // index.ts) emits routineDue to the renderer, which runs the prompt.
  ipcMain.handle(HEARTH_CHANNELS.routinesList, () => routines.list())
  ipcMain.handle(HEARTH_CHANNELS.routinesCreate, (_e, input: CreateRoutineInput) => routines.create(input))
  ipcMain.handle(HEARTH_CHANNELS.routinesUpdate, (_e, id: string, patch: Partial<CreateRoutineInput>) => routines.update(id, patch))
  ipcMain.handle(HEARTH_CHANNELS.routinesSetEnabled, (_e, id: string, enabled: boolean) => routines.setEnabled(id, enabled))
  ipcMain.handle(HEARTH_CHANNELS.routinesDelete, (_e, id: string) => routines.remove(id))
  ipcMain.handle(HEARTH_CHANNELS.routinesRunNow, (_e, id: string) => scheduler.runNow(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsArchive, (_e, id: string) => sessions.archive(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsDelete, (_e, id: string) => sessions.remove(id))
  ipcMain.handle(HEARTH_CHANNELS.sessionsDuplicate, (_e, id: string) => sessions.duplicate(id))

  // Terminal: a real PTY per panel. Output streams to the renderer keyed by id.
  const terminals = new TerminalManager(
    (id, data) => window.webContents.send(HEARTH_CHANNELS.terminalData, { id, data }),
    (id) => window.webContents.send(HEARTH_CHANNELS.terminalExit, { id }),
  )
  ipcMain.on(HEARTH_CHANNELS.terminalCreate, (_e, p: { id: string; cwd?: string; cols?: number; rows?: number }) => {
    // A PTY spawns a real shell, so anchor it only at a registered workspace; an
    // unknown cwd is dropped rather than spawned at an arbitrary directory.
    void at(p.cwd)
      .then((cwd) => terminals.create(p.id, cwd, p.cols, p.rows))
      .catch(() => window.webContents.send(HEARTH_CHANNELS.terminalExit, { id: p.id }))
  })
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

  // Files (workspace-rooted; cwd defaults to the Hearth repo and is validated
  // against the registered workspaces — see `at` above).
  ipcMain.handle(HEARTH_CHANNELS.fsList, async (_e, cwd: string | undefined, rel?: string) => listDir(await at(cwd), rel))
  ipcMain.handle(HEARTH_CHANNELS.fsRead, async (_e, cwd: string | undefined, rel: string) => fsReadFile(await at(cwd), rel))
  // Hard-denies island/blocked writes when the cwd is the Hearth repo (U4) —
  // the Files tab and eval_js-driven writes are indistinguishable here.
  ipcMain.handle(HEARTH_CHANNELS.fsWrite, async (_e, cwd: string | undefined, rel: string, content: string) =>
    writeFileGuarded(await at(cwd), repoRoot, rel, content),
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
    // a spawned adapter). For the INACTIVE backend we still report a truthful,
    // independent state: API-key presence is already known via `mode`/`keySource`;
    // for subscription we presence-check the CLI's own stored login (never reading
    // the token value — COMPLIANCE.md) so the user sees both backends are usable.
    if (kind !== host.kind) {
      return auth.mode === 'subscription' ? { ...base, loginPresent: hasStoredLogin(kind) } : base
    }
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
  ipcMain.handle(HEARTH_CHANNELS.mcpRemove, (_e, id: string) => {
    // A5: clean up the server's stored secrets so they don't orphan in the keyring.
    const cfg = mcp.get(id)
    if (cfg) for (const e of cfg.env) if (e.secretKey) secrets.delete(e.secretKey)
    return mcp.remove(id)
  })
  ipcMain.handle(HEARTH_CHANNELS.mcpSetEnabled, (_e, id: string, enabled: boolean) => mcp.setEnabled(id, enabled))
  ipcMain.handle(HEARTH_CHANNELS.mcpTest, async (_e, id: string) => {
    const cfg = mcp.get(id)
    if (!cfg) return { ok: false, error: 'Server not found' }
    return probeServer(cfg, secrets)
  })
  // A2: read-only view of the connectors each backend loads from its own CLI
  // config. cwd scopes Claude's local/project servers; defaults to the repo root.
  ipcMain.handle(HEARTH_CHANNELS.connectorsActive, (_e, cwd?: string) => readActiveConnectors(cwd || repoRoot))

  // Skills: read-only discovery (global + the active workspace).
  ipcMain.handle(HEARTH_CHANNELS.skillsList, (_e, cwd?: string) => ({
    skills: listSkills(cwd || repoRoot),
    commands: host.advertisedCommands(),
  }))
  ipcMain.handle(HEARTH_CHANNELS.skillsReveal, () => void shell.openPath(globalSkillsDir()))
  ipcMain.handle(HEARTH_CHANNELS.skillsSetEnabled, (_e, path: string, enabled: boolean) =>
    setSkillEnabled(path, enabled),
  )

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

  // Auto-update: status pushes flow over update:status from the updater itself;
  // these are the renderer's pull/command handles.
  ipcMain.handle(HEARTH_CHANNELS.updateGet, () => updater.getStatus())
  ipcMain.handle(HEARTH_CHANNELS.updateCheck, () => updater.check())
  ipcMain.handle(HEARTH_CHANNELS.updateInstall, () => updater.installNow())

  // Double-clicking the title-bar strip zooms the window to fill the screen, and
  // again restores the previous frame (macOS "zoom"). maximize/unmaximize remembers
  // the prior bounds for us.
  ipcMain.on(HEARTH_CHANNELS.windowZoomToggle, () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(HEARTH_CHANNELS.microAppCreate, (_e, name: string, starter?: string) =>
    scaffoldMicroApp(repoRoot, name, starter),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppList, () => listMicroApps(repoRoot))
  ipcMain.handle(HEARTH_CHANNELS.microAppStarters, () => listStarters(repoRoot))
  ipcMain.handle(HEARTH_CHANNELS.microAppStart, async (_e, name: string) => {
    const url = await startMicroApp(repoRoot, name)
    // Hand the frame its per-app broker token + origin so it can make authed calls
    // without ever holding the secret. The token only reaches this app's approved
    // hosts (W6/W7). Passed as query params the app reads from location.search.
    const brokerOrigin = broker.origin()
    if (!brokerOrigin) return url
    const u = new URL(url)
    u.searchParams.set('__hearthBroker', brokerOrigin)
    u.searchParams.set('__hearthToken', broker.tokenFor(name))
    return u.toString()
  })
  ipcMain.handle(HEARTH_CHANNELS.microAppStop, (_e, name: string) => stopMicroApp(name))
  ipcMain.handle(HEARTH_CHANNELS.microAppCapabilities, (_e, name: string) =>
    capabilities.capabilities(repoRoot, name),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppApprove, (_e, name: string, hosts: string[]) =>
    capabilities.approve(name, hosts),
  )
  ipcMain.handle(HEARTH_CHANNELS.microAppRevoke, (_e, name: string, host?: string) =>
    capabilities.revoke(name, host),
  )

  app.on('before-quit', () => {
    terminals.disposeAll()
    void host.dispose()
  })
}
