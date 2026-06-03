import type { PermissionRequest } from '../../../electron/shared/protocol'

export interface HumanPermission {
  /** Plain-language sentence describing what Hearth is asking to do. */
  lead: string
  /** Optional secondary detail shown in monospace (e.g. the shell command). */
  detail?: string
}

/**
 * Turn a mid-turn permission ask into language a non-developer can act on.
 *
 * The payload carries a coarse `category` and (for shell) the raw `command`, but
 * no structured tool name — so we frame by category and surface the command,
 * falling back to the agent-supplied `title` for anything we don't recognize.
 * Nothing is ever hidden; the raw ask is always reachable as the fallback lead.
 */
export function humanizePermission(req: PermissionRequest): HumanPermission {
  switch (req.category) {
    case 'execute':
      return { lead: 'Hearth wants to run a command in the terminal.', detail: req.command }
    case 'edit':
      // The agent's title here is usually a concrete "edit <file>" — keep it.
      return { lead: req.title || 'Hearth wants to edit files in your workspace.' }
    default:
      // 'other' (reads, search, connectors) and unknown: the agent title is the
      // most specific description we have.
      return { lead: req.title || 'Hearth wants your permission to continue.' }
  }
}
