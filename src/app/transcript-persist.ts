import type { TranscriptEntry } from '../../electron/main/sessions/store'

// Shared transcript persistence. Appends are serialized PER SESSION through one
// promise chain each, so JSONL lines never interleave and stay in stream order —
// even when the active session (ChatView) and a background session (the background
// persister) are both writing concurrently. Used by both so there's one code path
// and no double-write: ChatView persists the active session, the background
// persister persists every other session. See docs/PRESENCE.md (#6).

const chains = new Map<string, Promise<unknown>>()

export function persistEntries(sessionId: string, entries: TranscriptEntry[]): void {
  if (!entries.length) return
  const prev = chains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(() => window.hearth.sessions.append(sessionId, entries)).catch(() => {})
  chains.set(sessionId, next)
}
