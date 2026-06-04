import { useEffect } from 'react'
import { toast } from '@/shell/toast'
import { runBackgroundTurn } from '../sessions'

// Runs routines the main-process scheduler reports as due. Main never drives the
// agent — when a routine fires, we create a session in its workspace and run the
// turn IN THE BACKGROUND (no active-switch, no navigation), so a routine firing
// while you work doesn't hijack your screen. Its progress shows in the rail via
// presence; its reply lands in the transcript via the background persister, and the
// turn runs through main's per-cwd-serialized handler so it can't collide with a
// foreground turn on the same repo. See docs/PRESENCE.md (#6).
//
// Routines therefore fire only while Hearth is open; a fire that arrives while the
// app is closed is dropped by the scheduler, not queued.
export function useRoutineRunner(): void {
  useEffect(() => {
    return window.hearth.routines.onDue(async (r) => {
      const workspaces = await window.hearth.workspaces.list()
      const ws = workspaces.find((w) => w.id === r.workspaceId)
      if (!ws) {
        toast(`Routine “${r.title}” skipped — its workspace is no longer available`)
        return
      }
      toast(`Running routine: ${r.title}`)
      const meta = await window.hearth.sessions.create({ workspaceId: ws.id, cwd: ws.path, self: ws.isHearth })
      await runBackgroundTurn(meta, r.prompt)
    })
  }, [])
}
