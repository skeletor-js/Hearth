// The backend-agnostic agent contract. The renderer talks to this shape; it
// never knows whether Claude Code or Codex is behind it.

export type AgentKind = 'claude' | 'codex'

export type AgentAuth =
  | { mode: 'subscription' } // user already ran `claude login`; we inherit it
  | { mode: 'api-key'; envVar: string } // BYO key, read from the user's env

export interface AgentConfig {
  kind: AgentKind
  /** Working directory the agent operates in (the Hearth repo, for self-mod). */
  cwd: string
  auth: AgentAuth
}

/** A single streamed update from a turn — mirrors ACP `session/update`. */
export type SessionUpdate =
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool-call'; id: string; title: string; status: 'pending' | 'running' | 'done' | 'error' }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'end'; stopReason: string }

/** Permission ask raised mid-turn. The UI must answer or the agent hangs. */
export interface PermissionRequest {
  id: string
  title: string
  options: Array<{ id: string; label: string; kind: 'allow' | 'allow-always' | 'reject' }>
}

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
