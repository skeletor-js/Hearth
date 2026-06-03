import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@/shell/toast'
import { useSession } from '../session-store'
import { startSession } from '../sessions'

// Runs routines the main-process scheduler reports as due. Main never drives the
// agent — when a routine fires, we start a session in its workspace and hand the
// prompt to chat through the same pendingPrompt path History uses, so the turn
// runs on the proven interactive path (and its reply lands in the transcript).
//
// Routines therefore fire only while Hearth is open; a fire that arrives while
// the app is closed is dropped by the scheduler, not queued.
export function useRoutineRunner(): void {
  const navigate = useNavigate()
  useEffect(() => {
    return window.hearth.routines.onDue(async (r) => {
      const workspaces = await window.hearth.workspaces.list()
      const ws = workspaces.find((w) => w.id === r.workspaceId)
      if (!ws) {
        toast(`Routine “${r.title}” skipped — its workspace is no longer available`)
        return
      }
      toast(`Running routine: ${r.title}`)
      // Queue the prompt first so the session-restore effect picks it up the moment
      // the new session becomes active.
      useSession.getState().setPendingPrompt(r.prompt)
      await startSession(ws)
      void navigate({ to: '/chat' })
    })
  }, [navigate])
}
