// The backend-agnostic agent contract. The renderer talks to this shape; it
// never knows whether Claude Code or Codex is behind it.

export type { AgentKind } from '../../shared/protocol.js'
import type { AgentKind } from '../../shared/protocol.js'

export type AgentAuth =
  | { mode: 'subscription' } // user already ran `claude login`; we inherit it
  | { mode: 'api-key'; key: string; source: 'secret' | 'env' } // BYO key (our store or env)

export interface AgentConfig {
  kind: AgentKind
  /** Working directory the agent operates in (the Hearth repo, for self-mod). */
  cwd: string
  auth: AgentAuth
}

// The streamed-update and permission shapes live in shared/ so the renderer and
// preload import the exact same definitions. Re-exported here for main-process code.
export type { SessionUpdate, PermissionRequest, PermissionOption, PlanEntry, AgentModel, ModelState, AuthMethodInfo, AvailableCommand } from '../../shared/protocol.js'
import type { SessionUpdate, PermissionRequest, ModelState, AuthMethodInfo, AvailableCommand } from '../../shared/protocol.js'

export interface AgentSession {
  readonly id: string
  /** Models the backend offered for this session (may be empty). */
  readonly models: ModelState
  prompt(text: string): Promise<void>
  /** Switch the model for this session (no-op if the backend exposes none). */
  setModel(modelId: string): Promise<void>
  cancel(): Promise<void>
  dispose(): Promise<void>
}

/** Per-session options. `cwd` is the task working directory (the workspace). */
export interface NewSessionOptions {
  cwd?: string
}

export interface Agent {
  readonly kind: AgentKind
  /** Spawn the ACP adapter subprocess and complete the ACP handshake. */
  connect(): Promise<void>
  newSession(opts?: NewSessionOptions): Promise<AgentSession>
  /** Streamed updates for a session id. */
  onUpdate(cb: (sessionId: string, update: SessionUpdate) => void): () => void
  /** Resolve a permission request by option id. */
  onPermission(cb: (sessionId: string, req: PermissionRequest) => Promise<string>): void
  /** Auth methods the adapter advertised at initialize (empty until connected). */
  authMethods?(): AuthMethodInfo[]
  /** Slash commands / skills the agent has advertised this connection. */
  advertisedCommands?(): AvailableCommand[]
  dispose(): Promise<void>
}
