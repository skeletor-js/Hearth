// Owns the *current* backend and presents a stable surface to IPC so the agent
// can be swapped at runtime (Claude <-> Codex) without re-wiring anything. IPC
// registers update/permission handlers once on the host; the host forwards them
// from whichever agent is live and re-points them on switch. The per-window
// session also lives here, so a switch transparently starts a fresh session.

import type { Agent, AgentKind, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

export type AgentFactory = (kind: AgentKind) => Agent
type UpdateHandler = (sessionId: string, update: SessionUpdate) => void
type PermissionHandler = (sessionId: string, req: PermissionRequest) => Promise<string>

export class AgentHost {
  private agent: Agent | null = null
  private ready: Promise<Agent> | null = null
  private session: AgentSession | null = null
  private offUpdate: (() => void) | null = null
  private readonly updateHandlers = new Set<UpdateHandler>()
  private permissionHandler: PermissionHandler | null = null

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

  async prompt(text: string): Promise<string> {
    const agent = await this.connect()
    this.session ??= await agent.newSession()
    await this.session.prompt(text)
    return this.session.id
  }

  async cancel(): Promise<void> {
    await this.session?.cancel()
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
    this.session = null
    await old?.dispose().catch(() => {})
  }

  async dispose(): Promise<void> {
    await this.teardown()
  }
}
