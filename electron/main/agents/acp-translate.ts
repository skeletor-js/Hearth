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
} from '@agentclientprotocol/sdk'
import type { ModelState, PermissionRequest, SessionUpdate } from './agent.js'

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
  return {
    id: req.toolCall.toolCallId,
    title: req.toolCall.title ?? 'Permission requested',
    options: req.options.map((o) => ({
      id: o.optionId,
      label: o.name,
      kind: mapPermissionKind(o.kind),
    })),
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
      const out: SessionUpdate[] = [
        {
          type: 'tool-call',
          id: update.toolCallId,
          title: update.title,
          status: mapToolStatus(update.status, false),
        },
      ]
      out.push(...diffsFromContent(update.content))
      return out
    }

    case 'tool_call_update': {
      const title = update.title ?? titles.get(update.toolCallId) ?? 'Tool call'
      if (update.title) titles.set(update.toolCallId, update.title)
      const out: SessionUpdate[] = [
        {
          type: 'tool-call',
          id: update.toolCallId,
          title,
          status: mapToolStatus(update.status, true),
        },
      ]
      out.push(...diffsFromContent(update.content))
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

    // mode/config/usage/command updates, and the echo of the user's own
    // message aren't part of the chat surface.
    default:
      return []
  }
}

type ToolContent = NonNullable<
  Extract<AcpSessionUpdate, { sessionUpdate: 'tool_call' }>['content']
>

function diffsFromContent(content: ToolContent | null | undefined): SessionUpdate[] {
  if (!content) return []
  const out: SessionUpdate[] = []
  for (const item of content) {
    if (item.type === 'diff') {
      out.push({ type: 'diff', path: item.path, oldText: item.oldText ?? null, newText: item.newText })
    }
  }
  return out
}
