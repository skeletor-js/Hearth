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

/** A selectable model exposed by the active backend (mirrors ACP `ModelInfo`). */
export interface AgentModel {
  id: string
  name: string
  description?: string
}

/** The models a backend offers + which is current (mirrors ACP `SessionModelState`). */
export interface ModelState {
  available: AgentModel[]
  current: string | null
}

/** A single plan task (mirrors ACP `PlanEntry`). */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

/** A single streamed update from a turn — mirrors ACP `session/update`.
 *
 * `parentToolCallId` (on `tool-call` and `diff`) is the id of the parent Task
 * tool-call when the update originates inside a subagent — sourced from the
 * adapter's `_meta.claudeCode.parentToolUseId`. Absent for the main thread. The
 * self-mod run tracker uses it to attribute writes to the subagent that made them. */
export type SessionUpdate =
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool-call'; id: string; title: string; status: 'pending' | 'running' | 'done' | 'error'; parentToolCallId?: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string; parentToolCallId?: string }
  | { type: 'plan'; entries: PlanEntry[] }
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
  /** Raw shell command when this is an execute ask — used to auto-reject
   * source-mutating shell so writes are forced onto the mediated path (W0b). */
  command?: string
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
