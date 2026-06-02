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

/** A permission/operating mode the backend advertises (mirrors ACP `SessionMode`). */
export interface SessionMode {
  id: string
  name: string
  description?: string
}

/** The modes a backend offers + which is current (mirrors ACP `SessionModeState`).
 * Claude: default/acceptEdits/plan/dontAsk(/bypassPermissions). Codex:
 * read-only/agent/agent-full-access. Rendered generically — no fixed label map. */
export interface ModeState {
  available: SessionMode[]
  current: string | null
}

/** One selectable value of a `select` config option (mirrors ACP select option). */
export interface ConfigSelectOption {
  value: string
  name: string
  description?: string
}

/** A generic agent-advertised session config option (mirrors ACP `SessionConfigOption`).
 * `category` is a UX hint (`mode | model | thought_level | <custom>`); the renderer
 * already surfaces mode + model via dedicated controls, so it renders only options
 * whose category is neither, keeping the surface forward-compatible. */
export type ConfigOption =
  | {
      id: string
      name: string
      description?: string
      category?: string
      type: 'select'
      current: string
      options: ConfigSelectOption[]
    }
  | {
      id: string
      name: string
      description?: string
      category?: string
      type: 'boolean'
      current: boolean
    }

/** Context-window + cost usage for a session (mirrors ACP `usage_update`). Tokens
 * here are context occupancy, not a billing breakdown; cost is cumulative session
 * spend reported by the adapter. See docs/COMPLIANCE.md (Agent-SDK metered pool). */
export interface Usage {
  /** Tokens currently in the context window. */
  used: number
  /** Total context-window size in tokens. */
  size: number
  /** Cumulative session cost, when the adapter reports it. */
  cost?: { amount: number; currency: string }
}

/** What the active backend accepts in a prompt beyond text (mirrors ACP
 * `promptCapabilities`). Drives which composer affordances are offered. */
export interface PromptCapabilities {
  image: boolean
  embeddedContext: boolean
}

/** An image attached to a prompt — base64 data + mime (mirrors ACP image block). */
export interface PromptImage {
  data: string
  mimeType: string
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
  | { type: 'commands'; commands: AvailableCommand[] }
  | { type: 'mode'; current: string }
  | { type: 'config'; options: ConfigOption[] }
  | { type: 'usage'; usage: Usage }
  | { type: 'info'; title: string }
  | { type: 'end'; stopReason: string }

/** A slash command / skill the agent advertises (mirrors ACP `AvailableCommand`). */
export interface AvailableCommand {
  name: string
  description?: string
}

/** An auth method the backend's ACP adapter advertises in its initialize response. */
export interface AuthMethodInfo {
  id: string
  name: string
  description?: string
}

/** What the renderer needs to show truthful per-backend auth state. We never claim
 * a subscription is "verified" — we report which credential mode is in effect and
 * whether the adapter connected. See docs/COMPLIANCE.md. */
export interface AuthState {
  kind: AgentKind
  /** Credential mode actually in effect for this backend. */
  mode: 'api-key' | 'subscription'
  /** Where the API key came from, when mode is api-key. */
  keySource?: 'secret' | 'env'
  /** The ACP handshake completed (the adapter spawned + initialized). Only the
   * active backend has a live adapter to report this. */
  connected: boolean
  /** Connect error, when the adapter failed to come up. */
  error?: string
  /** For the INACTIVE backend in subscription mode: whether the CLI's own stored
   * login is present (presence/expiry check only — never the token value). Lets
   * the UI show both backends as authorized without spawning the inactive one. */
  loginPresent?: boolean
  /** Auth methods the adapter advertises (drives the login affordances). */
  methods: AuthMethodInfo[]
}

/** One MCP connector a backend will load, surfaced read-only (managed by the CLI,
 * not by Hearth). Auth values are never included — only whether auth is set. */
export interface ActiveConnector {
  name: string
  /** Where the CLI config puts it: user (global), project (.mcp.json), or local
   * (per-directory). Codex servers are all global ('user'). */
  scope: 'user' | 'project' | 'local'
  transport: 'stdio' | 'http' | 'sse'
  /** Non-secret target: the URL (http/sse) or the command (stdio). */
  target: string
  /** Whether auth (headers/env) is configured — presence only, never the value. */
  hasAuth: boolean
}

/** Read-only snapshot of what each backend loads, plus whether each CLI resolves
 * on the PATH (drives detect-and-hint when claude/codex aren't installed). */
export interface ActiveConnectors {
  claude: ActiveConnector[]
  codex: ActiveConnector[]
  claudeCli: boolean
  codexCli: boolean
}

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
