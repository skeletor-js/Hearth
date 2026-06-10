import { useEffect } from 'react'
import { useShell } from '@/shell/store'
import { toast } from '@/shell/toast'
import { useSession } from './session-store'
import { usePresence } from './presence-store'
import { decidePermission } from './permission-policy'

// The single shell-level owner of the agent stream for PRESENCE — folds every
// `agent:update` and `permission:request` into the presence store keyed by the
// payload's sessionId, so background/routine sessions stay visible even when the
// user is looking at another one. Mounted once in the root layout.
//
// This is also the one place the tiered permission auto-approval runs (moved out of
// ChatView), so a permission ask from ANY session is approved or surfaced correctly
// regardless of which session's chat is on screen. ChatView still renders the active
// session's pending ask — it just reads it from presence now. See docs/PRESENCE.md.
export function usePresenceBridge(): void {
  useEffect(() => {
    const offUpdate = window.hearth.agent.onUpdate(({ sessionId, update }) => {
      if (!sessionId) return
      const isActive = useSession.getState().active?.id === sessionId
      usePresence.getState().applyUpdate(sessionId, update, isActive)
      // A finished turn flashes 'done' briefly, then settles to idle. A new turn
      // (markSending → 'thinking') makes this stale settle a no-op.
      if (update.type === 'end') {
        const settle = usePresence.getState().settle
        setTimeout(() => settle(sessionId), 4000)
      }
    })

    // agent:error is attributed to the session whose turn was in flight when the
    // adapter died (U5); a null sessionKey (boot-time connect failure) falls back
    // to the active session so it still surfaces somewhere visible.
    const offError = window.hearth.agent.onError(({ sessionKey }) => {
      const id = sessionKey ?? useSession.getState().active?.id
      if (id) usePresence.getState().setError(id)
    })

    const offPermission = window.hearth.permission.onRequest(({ sessionId, req }) => {
      if (!sessionId) return
      // The decision logic (approval tiers + the U7 headless fail-closed rule)
      // lives in permission-policy.ts; this just supplies context and acts.
      const presence = usePresence.getState()
      const decision = decidePermission(req, {
        mode: useShell.getState().approval,
        isActiveSession: useSession.getState().active?.id === sessionId,
        isBackgroundRun: presence.byId[sessionId]?.backgroundRun ?? false,
      })
      if (decision.action === 'respond') {
        window.hearth.permission.respond(req.id, decision.optionId)
        if (decision.reason === 'fail-closed') {
          // A headless run declined something nobody was there to approve —
          // flag the run for a look rather than letting "done" hide it.
          presence.flagAttention(sessionId, `Declined unattended: ${req.title}`)
          toast('A routine declined a permission while unattended')
        }
        return
      }
      presence.setPermission(sessionId, req)
      // Nudge when the ask belongs to a session the user isn't looking at — the
      // inline ApproveCard would otherwise be hidden. The WaitingBanner deep-links.
      if (useSession.getState().active?.id !== sessionId) toast('An agent needs your approval')
    })

    return () => {
      offUpdate()
      offError()
      offPermission()
    }
  }, [])
}
