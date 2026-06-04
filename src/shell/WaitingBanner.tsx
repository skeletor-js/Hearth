import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from './Icon'
import { useSession } from '@/app/session-store'
import { usePresence } from '@/app/presence-store'
import { openSession } from '@/app/sessions'
import type { SessionMeta } from '../../electron/main/sessions/store'

// "Waiting on you" — a shell-level surface for permission asks raised by sessions
// other than the one on screen. The active session's ask renders inline in chat;
// this catches the background/routine ones so an agent can't get stuck silently
// tapping your shoulder where you can't see it. Clicking jumps to that session.
// See docs/PRESENCE.md (P2).
export function WaitingBanner() {
  const byId = usePresence((s) => s.byId)
  const activeId = useSession((s) => s.active?.id)
  const sessionsNonce = useSession((s) => s.sessionsNonce)
  const navigate = useNavigate()
  const [metas, setMetas] = useState<SessionMeta[]>([])

  const waiting = useMemo(
    () => Object.keys(byId).filter((id) => byId[id]?.pendingPermission && id !== activeId),
    [byId, activeId],
  )
  const waitingKey = waiting.join(',')

  useEffect(() => {
    if (waiting.length) void window.hearth.sessions.list().then(setMetas)
    // waitingKey drives the refetch when the waiting set changes.
  }, [waitingKey, sessionsNonce])

  if (!waiting.length) return null

  const first = waiting[0]
  const title = metas.find((m) => m.id === first)?.title ?? 'An agent'
  const label = waiting.length === 1 ? `${title} needs you` : `${waiting.length} agents need you`

  const go = () => {
    const m = metas.find((x) => x.id === first)
    if (m) openSession(m)
    void navigate({ to: '/chat' })
  }

  return (
    <button className="waiting-banner" onClick={go} title="Jump to the waiting session">
      <Icon name="seal-question" fill className="ico-13" />
      <span>{label}</span>
      <Icon name="arrow-up-right" className="arrow" />
    </button>
  )
}
