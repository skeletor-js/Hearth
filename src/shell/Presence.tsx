import type { PresenceStatus } from '@/app/presence-store'

// Shared presence UI atoms — the ambient "what is this agent doing" marks rendered
// across the shell (rail dots, status words). See docs/PRESENCE.md.

const WORD: Record<PresenceStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  waiting: 'needs you',
  error: 'error',
  done: 'done',
}

/** True for the states worth surfacing ambiently (vs. the resting idle/done). */
export function isActiveStatus(s: PresenceStatus | undefined): s is PresenceStatus {
  return s === 'thinking' || s === 'working' || s === 'waiting' || s === 'error'
}

export function statusWord(s: PresenceStatus): string {
  return WORD[s]
}

const RANK: Record<PresenceStatus, number> = { idle: 0, done: 1, error: 2, thinking: 3, working: 4, waiting: 5 }

/** The single status that best represents the whole fleet for the brand flame —
 * "needs you" wins over "working" wins over rest. */
export function aggregateStatus(byId: Record<string, { status: PresenceStatus }>): PresenceStatus {
  let best: PresenceStatus = 'idle'
  for (const id in byId) {
    const s = byId[id]?.status
    if (s && RANK[s] > RANK[best]) best = s
  }
  return best
}

/** A small status dot keyed to presence: pulsing accent while busy, warn when it
 * needs you, faint at rest. Pulse is neutralized by the global reduce-motion rule. */
export function PresenceDot({ status, title }: { status: PresenceStatus; title?: string }) {
  return <span className={`presence-dot is-${status}`} title={title ?? WORD[status]} aria-hidden={!title} />
}
