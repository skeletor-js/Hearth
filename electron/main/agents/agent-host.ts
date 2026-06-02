// Owns the *current* backend and presents a stable surface to IPC so the agent
// can be swapped at runtime (Claude <-> Codex) without re-wiring anything. IPC
// registers update/permission handlers once on the host; the host forwards them
// from whichever agent is live and re-points them on switch. The per-window
// session also lives here, so a switch transparently starts a fresh session.

import type { Agent, AgentKind, AgentSession, AuthMethodInfo, AvailableCommand, ConfigOption, ModelState, ModeState, PermissionRequest, PromptCapabilities, PromptImage, SessionUpdate, Usage } from './agent.js'

export type AgentFactory = (kind: AgentKind) => Agent
type UpdateHandler = (sessionId: string, update: SessionUpdate) => void
type PermissionHandler = (sessionId: string, req: PermissionRequest) => Promise<string>
type ModelsHandler = (state: ModelState) => void
type ModeHandler = (state: ModeState) => void
type ConfigHandler = (options: ConfigOption[]) => void
type UsageHandler = (usage: Usage) => void
type CommandsHandler = (commands: AvailableCommand[]) => void

const EMPTY_MODELS: ModelState = { available: [], current: null }
const EMPTY_MODES: ModeState = { available: [], current: null }

// The default permission mode applied to every new session, per backend. Both are
// the "prompt for dangerous operations" baseline (replaces the old acceptEdits
// settings-file workaround — see claude.ts). Rendered/driven generically via ACP.
const DEFAULT_MODE: Record<AgentKind, string> = { claude: 'default', codex: 'agent' }

export class AgentHost {
  private agent: Agent | null = null
  private ready: Promise<Agent> | null = null
  // ACP sessions keyed by the renderer's persistent session id, so each
  // conversation keeps its own agent session (and task cwd). Cleared on switch.
  private sessions = new Map<string, AgentSession>()
  private activeKey: string | null = null
  private offUpdate: (() => void) | null = null
  private readonly updateHandlers = new Set<UpdateHandler>()
  private permissionHandler: PermissionHandler | null = null
  // Latest model state per backend kind (captured on session creation) + the
  // user's preferred model per kind (re-applied to new sessions of that kind).
  private modelsByKind = new Map<AgentKind, ModelState>()
  private preferredModel = new Map<AgentKind, string>()
  private readonly modelsHandlers = new Set<ModelsHandler>()
  // Latest mode/config/usage per backend kind, plus the user's preferred mode
  // (re-applied to new sessions of that kind, like preferredModel).
  private modesByKind = new Map<AgentKind, ModeState>()
  private preferredMode = new Map<AgentKind, string>()
  private configByKind = new Map<AgentKind, ConfigOption[]>()
  private usageByKind = new Map<AgentKind, Usage>()
  private readonly modeHandlers = new Set<ModeHandler>()
  private readonly configHandlers = new Set<ConfigHandler>()
  private readonly usageHandlers = new Set<UsageHandler>()
  private readonly commandsHandlers = new Set<CommandsHandler>()

  constructor(
    private readonly factory: AgentFactory,
    private currentKind: AgentKind,
  ) {}

  get kind(): AgentKind {
    return this.currentKind
  }

  /** Persisted across switches — forwards from whatever agent is current. */
  onUpdate(cb: UpdateHandler): () => void {
    this.updateHandlers.add(cb)
    return () => this.updateHandlers.delete(cb)
  }

  /** Persisted across switches. */
  onPermission(cb: PermissionHandler): void {
    this.permissionHandler = cb
  }

  /** Spawn + connect the current backend (idempotent; retries after a failure). */
  connect(): Promise<Agent> {
    if (!this.ready) {
      const agent = this.factory(this.currentKind)
      this.agent = agent
      this.offUpdate = agent.onUpdate((sessionId, update) => {
        // Live mode/config/usage updates maintain the per-kind cache and fire the
        // dedicated change handlers (the renderer's chat surface ignores them).
        this.absorbUpdate(update)
        for (const h of this.updateHandlers) h(sessionId, update)
      })
      agent.onPermission((sessionId, req) =>
        this.permissionHandler
          ? this.permissionHandler(sessionId, req)
          : Promise.reject(new Error('no permission handler registered')),
      )
      this.ready = agent.connect().then(
        () => agent,
        (err) => {
          // Let a later attempt rebuild from scratch rather than caching the failure.
          this.ready = null
          this.agent = null
          this.offUpdate?.()
          this.offUpdate = null
          throw err
        },
      )
    }
    return this.ready
  }

  /**
   * Prompt within a renderer session. `key` is the renderer's session id (one
   * ACP session per key); `cwd` sets that session's task working directory.
   */
  async prompt(text: string, opts?: { key?: string; cwd?: string; images?: PromptImage[] }): Promise<string> {
    const agent = await this.connect()
    const key = opts?.key ?? 'default'
    let session = this.sessions.get(key)
    if (!session) {
      session = await agent.newSession({ cwd: opts?.cwd })
      this.sessions.set(key, session)
      // Cache the models this backend offered; apply the user's preferred model
      // (chosen for this kind) if it differs from the session's default.
      let state = session.models
      const preferred = this.preferredModel.get(this.currentKind)
      if (preferred && preferred !== state.current && state.available.some((m) => m.id === preferred)) {
        await session.setModel(preferred)
        state = { ...state, current: preferred }
      }
      this.setModelCache(state)
      await this.initModes(session)
      this.setConfigCache(session.configOptions)
      // A fresh ACP session starts usage from zero; drop the prior session's
      // figure so the UI doesn't show stale cost until the first turn reports.
      this.usageByKind.delete(this.currentKind)
    }
    this.activeKey = key
    await session.prompt(text, opts?.images)
    return session.id
  }

  /** Prompt capabilities the current backend advertised (image / embedded context). */
  promptCapabilities(): PromptCapabilities {
    return this.agent?.promptCapabilities?.() ?? { image: false, embeddedContext: false }
  }

  async cancel(): Promise<void> {
    if (this.activeKey) await this.sessions.get(this.activeKey)?.cancel()
  }

  /** Models the current backend offers (cached from the latest session). */
  getModels(): ModelState {
    return this.modelsByKind.get(this.currentKind) ?? EMPTY_MODELS
  }

  onModelsChanged(cb: ModelsHandler): () => void {
    this.modelsHandlers.add(cb)
    return () => this.modelsHandlers.delete(cb)
  }

  /** Switch the current backend's model — applied to the active session and
   * remembered as the preferred model for new sessions of this kind. */
  async setModel(modelId: string): Promise<void> {
    this.preferredModel.set(this.currentKind, modelId)
    if (this.activeKey) await this.sessions.get(this.activeKey)?.setModel(modelId)
    const cur = this.getModels()
    this.setModelCache({ ...cur, current: modelId })
  }

  private setModelCache(state: ModelState): void {
    this.modelsByKind.set(this.currentKind, state)
    for (const h of this.modelsHandlers) h(state)
  }

  // --- Modes -----------------------------------------------------------------

  /** Apply the preferred (or default) mode to a new session and cache it. */
  private async initModes(session: AgentSession): Promise<void> {
    let state = session.modes
    const want = this.preferredMode.get(this.currentKind) ?? DEFAULT_MODE[this.currentKind]
    if (want && want !== state.current && state.available.some((m) => m.id === want)) {
      await session.setMode(want)
      state = { ...state, current: want }
    }
    this.setModeCache(state)
  }

  /** Modes the current backend offers (cached from the latest session). */
  getModes(): ModeState {
    return this.modesByKind.get(this.currentKind) ?? EMPTY_MODES
  }

  onModeChanged(cb: ModeHandler): () => void {
    this.modeHandlers.add(cb)
    return () => this.modeHandlers.delete(cb)
  }

  /** Switch the permission mode — applied to the active session and remembered as
   * the preferred mode for new sessions of this kind. */
  async setMode(modeId: string): Promise<void> {
    this.preferredMode.set(this.currentKind, modeId)
    if (this.activeKey) await this.sessions.get(this.activeKey)?.setMode(modeId)
    this.setModeCache({ ...this.getModes(), current: modeId })
  }

  private setModeCache(state: ModeState): void {
    this.modesByKind.set(this.currentKind, state)
    for (const h of this.modeHandlers) h(state)
  }

  // --- Generic config options ------------------------------------------------

  /** Config options the current backend offers (cached from the latest session). */
  getConfigOptions(): ConfigOption[] {
    return this.configByKind.get(this.currentKind) ?? []
  }

  onConfigChanged(cb: ConfigHandler): () => void {
    this.configHandlers.add(cb)
    return () => this.configHandlers.delete(cb)
  }

  /** Set a generic config option on the active session. */
  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    if (this.activeKey) await this.sessions.get(this.activeKey)?.setConfigOption(configId, value)
  }

  private setConfigCache(options: ConfigOption[]): void {
    this.configByKind.set(this.currentKind, options)
    for (const h of this.configHandlers) h(options)
  }

  // --- Usage -----------------------------------------------------------------

  /** Latest usage for the current backend (null until a turn reports it). */
  getUsage(): Usage | null {
    return this.usageByKind.get(this.currentKind) ?? null
  }

  onUsageChanged(cb: UsageHandler): () => void {
    this.usageHandlers.add(cb)
    return () => this.usageHandlers.delete(cb)
  }

  private setUsageCache(usage: Usage): void {
    this.usageByKind.set(this.currentKind, usage)
    for (const h of this.usageHandlers) h(usage)
  }

  // --- Advertised commands ---------------------------------------------------

  onCommandsChanged(cb: CommandsHandler): () => void {
    this.commandsHandlers.add(cb)
    return () => this.commandsHandlers.delete(cb)
  }

  /** Fold a live mode/config/usage/commands update into the cache + handlers. */
  private absorbUpdate(update: SessionUpdate): void {
    if (update.type === 'mode') {
      this.setModeCache({ ...this.getModes(), current: update.current })
    } else if (update.type === 'config') {
      this.setConfigCache(update.options)
    } else if (update.type === 'usage') {
      this.setUsageCache(update.usage)
    } else if (update.type === 'commands') {
      for (const h of this.commandsHandlers) h(update.commands)
    }
  }

  /** Tear down the current backend and bring up `kind`. No-op if already on it. */
  async switchTo(kind: AgentKind): Promise<void> {
    if (kind === this.currentKind && this.agent) return
    await this.teardown()
    this.currentKind = kind
    await this.connect()
  }

  /** Rebuild the current backend from scratch — used when its credential changed
   * after connect (a new/cleared API key only takes effect on a fresh spawn). */
  async reconnect(): Promise<void> {
    await this.teardown()
    await this.connect()
  }

  /** True once the current backend's adapter is spawned + initialized. */
  isConnected(): boolean {
    return this.agent != null
  }

  /** Auth methods the current backend advertised at initialize (empty if down). */
  authMethods(): AuthMethodInfo[] {
    return this.agent?.authMethods?.() ?? []
  }

  /** Slash commands / skills the current backend has advertised. */
  advertisedCommands(): AvailableCommand[] {
    return this.agent?.advertisedCommands?.() ?? []
  }

  private async teardown(): Promise<void> {
    this.offUpdate?.()
    this.offUpdate = null
    const old = this.agent
    this.agent = null
    this.ready = null
    this.sessions.clear()
    this.activeKey = null
    await old?.dispose().catch(() => {})
  }

  async dispose(): Promise<void> {
    await this.teardown()
  }
}
