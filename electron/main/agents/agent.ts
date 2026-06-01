// The backend-agnostic agent contract. The renderer talks to this shape; it
// never knows whether Claude Code or Codex is behind it.

export type { AgentKind } from '../../shared/protocol.js'
import type { AgentKind } from '../../shared/protocol.js'

export type AgentAuth =
  | { mode: 'subscription' } // user already ran `claude login`; we inherit it
  | { mode: 'api-key'; envVar: string } // BYO key, read from the user's env

export interface AgentConfig {
  kind: AgentKind
  /** Working directory the agent operates in (the Hearth repo, for self-mod). */
  cwd: string
  auth: AgentAuth
}

// The streamed-update and permission shapes live in shared/ so the renderer and
// preload import the exact same definitions. Re-exported here for main-process code.
export type { SessionUpdate, PermissionRequest, PermissionOption, PlanEntry } from '../../shared/protocol.js'
import type { SessionUpdate, PermissionRequest } from '../../shared/protocol.js'

export interface AgentSession {
  readonly id: string
  prompt(text: string): Promise<void>
  cancel(): Promise<void>
  dispose(): Promise<void>
}

export interface Agent {
  readonly kind: AgentKind
  /** Spawn the ACP adapter subprocess and complete the ACP handshake. */
  connect(): Promise<void>
  newSession(): Promise<AgentSession>
  /** Streamed updates for a session id. */
  onUpdate(cb: (sessionId: string, update: SessionUpdate) => void): () => void
  /** Resolve a permission request by option id. */
  onPermission(cb: (sessionId: string, req: PermissionRequest) => Promise<string>): void
  dispose(): Promise<void>
}
