import { useEffect } from 'react'
import { useSession } from './session-store'
import { persistEntries } from './transcript-persist'

// Persist transcript updates for sessions OTHER than the one ChatView is showing, so
// background/routine turns are durable even with no chat surface mounted for them.
// ChatView persists the active session; this covers every other session. The two are
// partitioned by the active id, so exactly one handles any given update — no
// double-write. Mounted once in the root layout. See docs/PRESENCE.md (#6).
export function useBackgroundPersister(): void {
  useEffect(() => {
    return window.hearth.agent.onUpdate(({ sessionId, update }) => {
      if (!sessionId) return
      if (useSession.getState().active?.id === sessionId) return // ChatView owns the active session
      // An agent-supplied title renames the (background) session + refreshes the rail.
      if (update.type === 'info') {
        void window.hearth.sessions.rename(sessionId, update.title).then(() => useSession.getState().bumpSessions())
        return
      }
      persistEntries(sessionId, [{ kind: 'update', update }])
    })
  }, [])
}
