// The wire contract shared across the process boundary: what main streams to the
// renderer for a turn, and the permission ask the renderer must answer. Lives in
// shared/ (not agents/) so the renderer and preload can import the exact same
// types main produces — no hand-mirrored shapes that drift. agent.ts re-exports
// these for the main-process agent code.

/** The selectable agent backends. */
export type AgentKind = 'claude' | 'codex'

/** Current-backend status (main → renderer on the backend-changed channel). */
export interface BackendStatus {
  kind: AgentKind
  /** Present if the backend failed to connect after a switch. */
  error?: string
}

/** A single streamed update from a turn — mirrors ACP `session/update`. */
export type SessionUpdate =
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool-call'; id: string; title: string; status: 'pending' | 'running' | 'done' | 'error' }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'end'; stopReason: string }

/** One option the user can pick when answering a permission ask. */
export interface PermissionOption {
  id: string
  label: string
  kind: 'allow' | 'allow-always' | 'reject'
}

/** Permission ask raised mid-turn. The UI must answer or the agent hangs. */
export interface PermissionRequest {
  id: string
  title: string
  options: PermissionOption[]
}

/** Payload shape for the `agent:update` channel (main → renderer). */
export interface AgentUpdatePayload {
  sessionId: string
  update: SessionUpdate
}

/** Payload shape for the `permission:request` channel (main → renderer). */
export interface PermissionRequestPayload {
  sessionId: string
  req: PermissionRequest
}
