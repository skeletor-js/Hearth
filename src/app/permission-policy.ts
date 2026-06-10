// Permission-ask policy (U7). One pure decision for every ask the bridge
// receives: auto-approve per the user's tier, surface to the user, or — for a
// HEADLESS turn's ask that would otherwise sit unanswered overnight — fail
// closed by picking the request's reject option (owner decision: routines run
// unattended, so an unanswerable ask must decline and flag, never hang).
//
// Fail-closed applies only where today's behavior would surface-and-wait: the
// user's 'auto'/'commands' tiers still auto-approve background asks exactly as
// they do foreground ones.
import type { PermissionRequest } from '../../electron/shared/protocol'

export type ApprovalMode = 'always' | 'commands' | 'auto'

export interface PermissionContext {
  mode: ApprovalMode
  /** The ask's session is the one on screen (the user can actually answer). */
  isActiveSession: boolean
  /** The session's turn was started headless (routine runner), not by the user. */
  isBackgroundRun: boolean
}

export type PermissionDecision =
  | { action: 'respond'; optionId: string; reason: 'auto-approve' | 'fail-closed' }
  | { action: 'surface' }

export function decidePermission(req: PermissionRequest, ctx: PermissionContext): PermissionDecision {
  // Command-approval tiers (Settings → Agent). 'always' prompts for every ask;
  // 'commands' prompts only for shell/edit and silently approves reads/MCP;
  // 'auto' approves everything. Source-mutating shell is already auto-rejected
  // upstream in main. When no non-reject option exists, surface rather than guess.
  const mustPrompt = ctx.mode === 'always' || (ctx.mode === 'commands' && req.category !== 'other')
  if (!mustPrompt) {
    const allow = req.options.find((o) => o.kind === 'allow') ?? req.options.find((o) => o.kind === 'allow-always')
    if (allow) return { action: 'respond', optionId: allow.id, reason: 'auto-approve' }
  }
  // This ask needs a human. A headless (routine) turn nobody is watching has
  // none — decline via the request's own reject option so the agent moves on
  // (mirrors main's W0b auto-reject shape). No reject option → surface anyway;
  // a visible stuck ask beats answering with something the agent didn't offer.
  if (ctx.isBackgroundRun && !ctx.isActiveSession) {
    const reject = req.options.find((o) => o.kind === 'reject')
    if (reject) return { action: 'respond', optionId: reject.id, reason: 'fail-closed' }
  }
  return { action: 'surface' }
}
