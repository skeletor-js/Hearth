// Owns the *current* backend and presents a stable surface to IPC so the agent
// can be swapped at runtime (Claude <-> Codex) without re-wiring anything. IPC
// registers update/permission handlers once on the host; the host forwards them
// from whichever agent is live and re-points them on switch. The per-window
// session also lives here, so a switch transparently starts a fresh session.

import type { Agent, AgentKind, AgentSession, ModelState, PermissionRequest, SessionUpdate } from './agent.js'

export type AgentFactory = (kind: AgentKind) => Agent
type UpdateHandler = (sessionId: string, update: SessionUpdate) => void
type PermissionHandler = (sessionId: string, req: PermissionRequest) => Promise<string>
type ModelsHandler = (state: ModelState) => void

const EMPTY_MODELS: ModelState = { available: [], current: null }

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
  async prompt(text: string, opts?: { key?: string; cwd?: string }): Promise<string> {
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
    }
    this.activeKey = key
    await session.prompt(text)
    return session.id
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

  /** Tear down the current backend and bring up `kind`. No-op if already on it. */
  async switchTo(kind: AgentKind): Promise<void> {
    if (kind === this.currentKind && this.agent) return
    await this.teardown()
    this.currentKind = kind
    await this.connect()
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
