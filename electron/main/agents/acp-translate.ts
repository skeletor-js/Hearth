// Pure translation between the ACP SDK's wire types and Hearth's backend-
// agnostic SessionUpdate / PermissionRequest contracts (see agent.ts).
//
// Kept separate from acp-client.ts (which owns the live connection) precisely so
// this — where the protocol-mapping bugs live — is unit-testable without spawning
// an agent. acp-client.ts wires the connection to these functions.

import type {
  SessionUpdate as AcpSessionUpdate,
  RequestPermissionRequest,
  PermissionOptionKind,
  ToolCallStatus,
  SessionModelState,
  SessionModeState,
  SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type { ConfigOption, ModelState, ModeState, PermissionRequest, SessionUpdate } from './agent.js'

/** Normalize ACP's `SessionModelState` into Hearth's `{available, current}`. Pure. */
export function normalizeModels(state: SessionModelState | null | undefined): ModelState {
  if (!state) return { available: [], current: null }
  return {
    available: (state.availableModels ?? []).map((m) => ({
      id: m.modelId,
      name: m.name,
      description: m.description ?? undefined,
    })),
    current: state.currentModelId ?? null,
  }
}

/** Normalize ACP's `SessionModeState` into Hearth's `{available, current}`. Pure. */
export function normalizeModes(state: SessionModeState | null | undefined): ModeState {
  if (!state) return { available: [], current: null }
  return {
    available: (state.availableModes ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? undefined,
    })),
    current: state.currentModeId ?? null,
  }
}

/** Normalize ACP `SessionConfigOption`s into Hearth's `ConfigOption`. Pure.
 * Grouped selects are flattened into a single option list (adapters use flat
 * options today; flattening is forward-safe). Unknown shapes are skipped. */
export function normalizeConfigOptions(
  options: Array<SessionConfigOption> | null | undefined,
): ConfigOption[] {
  if (!options) return []
  const out: ConfigOption[] = []
  for (const o of options) {
    const base = {
      id: o.id,
      name: o.name,
      description: o.description ?? undefined,
      category: o.category ?? undefined,
    }
    if (o.type === 'boolean') {
      out.push({ ...base, type: 'boolean', current: o.currentValue })
    } else if (o.type === 'select') {
      // options is either SessionConfigSelectOption[] or SessionConfigSelectGroup[].
      const flat: { value: string; name: string; description?: string }[] = []
      for (const item of o.options) {
        if ('group' in item) {
          for (const opt of item.options) flat.push({ value: opt.value, name: opt.name, description: opt.description ?? undefined })
        } else {
          flat.push({ value: item.value, name: item.name, description: item.description ?? undefined })
        }
      }
      out.push({ ...base, type: 'select', current: o.currentValue, options: flat })
    }
  }
  return out
}

/** ACP tool-call status → our coarser lifecycle. */
export function mapToolStatus(
  status: ToolCallStatus | null | undefined,
  isUpdate: boolean,
): 'pending' | 'running' | 'done' | 'error' {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'error'
    default:
      // A bare tool_call with no status is just starting; an update with no
      // status is mid-flight.
      return isUpdate ? 'running' : 'pending'
  }
}

/** ACP permission-option kind → our three-way allow/allow-always/reject. */
export function mapPermissionKind(kind: PermissionOptionKind): 'allow' | 'allow-always' | 'reject' {
  switch (kind) {
    case 'allow_once':
      return 'allow'
    case 'allow_always':
      return 'allow-always'
    case 'reject_once':
    case 'reject_always':
      return 'reject'
  }
}

/**
 * Translate an ACP permission request into our UI-facing shape. The tool call's
 * id doubles as the permission id — it's stable and ties the answer back to the
 * tool that asked.
 */
export function translatePermission(req: RequestPermissionRequest): PermissionRequest {
  // Surface the raw shell command (when present) so the policy layer can
  // auto-reject source-mutating shell. ACP carries it in the tool call's raw input.
  const rawInput = (req.toolCall as { rawInput?: { command?: unknown } }).rawInput
  const command = typeof rawInput?.command === 'string' ? rawInput.command : undefined
  // Coarse category for the renderer's Command-approval tiers. A present raw
  // command means shell regardless of how the kind is labelled; otherwise map the
  // ACP tool kind. Unknown/missing kinds fall to 'other' (auto-approvable).
  const kind = (req.toolCall as { kind?: string }).kind
  const category: PermissionRequest['category'] =
    command || kind === 'execute' ? 'execute' : kind === 'edit' || kind === 'delete' || kind === 'move' ? 'edit' : 'other'
  return {
    id: req.toolCall.toolCallId,
    title: req.toolCall.title ?? 'Permission requested',
    options: req.options.map((o) => ({
      id: o.optionId,
      label: o.name,
      kind: mapPermissionKind(o.kind),
    })),
    category,
    ...(command ? { command } : {}),
  }
}

/**
 * Translate one ACP session update into zero or more Hearth updates. A single
 * tool call can yield a status update plus one diff per modified file, so this
 * returns an array.
 *
 * `titles` caches tool-call titles by id: ACP `tool_call_update` notifications
 * usually omit the title, so we backfill from the originating `tool_call`. The
 * map is read and written here by design — pass a per-session Map.
 */
export function translateUpdate(
  update: AcpSessionUpdate,
  titles: Map<string, string>,
): SessionUpdate[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? [{ type: 'message', role: 'assistant', text: update.content.text }]
        : []

    case 'agent_thought_chunk':
      return update.content.type === 'text' ? [{ type: 'thought', text: update.content.text }] : []

    case 'tool_call': {
      titles.set(update.toolCallId, update.title)
      const parent = parentToolCallId(update)
      const out: SessionUpdate[] = [
        {
          type: 'tool-call',
          id: update.toolCallId,
          title: update.title,
          status: mapToolStatus(update.status, false),
          ...(parent ? { parentToolCallId: parent } : {}),
        },
      ]
      out.push(...diffsFromContent(update.content, parent))
      return out
    }

    case 'tool_call_update': {
      const title = update.title ?? titles.get(update.toolCallId) ?? 'Tool call'
      if (update.title) titles.set(update.toolCallId, update.title)
      const parent = parentToolCallId(update)
      const out: SessionUpdate[] = [
        {
          type: 'tool-call',
          id: update.toolCallId,
          title,
          status: mapToolStatus(update.status, true),
          ...(parent ? { parentToolCallId: parent } : {}),
        },
      ]
      out.push(...diffsFromContent(update.content, parent))
      return out
    }

    case 'plan':
      return [
        {
          type: 'plan',
          entries: update.entries.map((e) => ({
            content: e.content,
            status: e.status,
            priority: e.priority,
          })),
        },
      ]

    case 'available_commands_update':
      // The agent's advertised slash commands / skills. Not chat content — the
      // client caches these for the Settings → Skills surface.
      return [
        {
          type: 'commands',
          commands: update.availableCommands.map((c) => ({
            name: c.name,
            description: c.description ?? undefined,
          })),
        },
      ]

    case 'current_mode_update':
      return [{ type: 'mode', current: update.currentModeId }]

    case 'config_option_update':
      return [{ type: 'config', options: normalizeConfigOptions(update.configOptions) }]

    case 'usage_update':
      return [
        {
          type: 'usage',
          usage: {
            used: update.used,
            size: update.size,
            ...(update.cost ? { cost: { amount: update.cost.amount, currency: update.cost.currency } } : {}),
          },
        },
      ]

    case 'session_info_update':
      // Agent-supplied session title (W9). Only emit when a non-empty title is set;
      // the renderer uses it to auto-title the session.
      return update.title ? [{ type: 'info', title: update.title }] : []

    // The echo of the user's own message isn't part of the surfaces Hearth drives.
    default:
      return []
  }
}

type ToolContent = NonNullable<
  Extract<AcpSessionUpdate, { sessionUpdate: 'tool_call' }>['content']
>

/**
 * The parent Task tool-call id when this update came from inside a subagent.
 * The Claude adapter stashes it at `_meta.claudeCode.parentToolUseId`; ACP's
 * `_meta` is an open record so we read it defensively. Codex doesn't populate it
 * (returns undefined → treated as the main thread). See SELF-MOD-HARDENING-PLAN W0.
 */
function parentToolCallId(update: { _meta?: unknown }): string | undefined {
  const meta = update._meta as { claudeCode?: { parentToolUseId?: unknown } } | undefined
  const id = meta?.claudeCode?.parentToolUseId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function diffsFromContent(
  content: ToolContent | null | undefined,
  parent?: string,
): SessionUpdate[] {
  if (!content) return []
  const out: SessionUpdate[] = []
  for (const item of content) {
    if (item.type === 'diff') {
      out.push({
        type: 'diff',
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
        ...(parent ? { parentToolCallId: parent } : {}),
      })
    }
  }
  return out
}
