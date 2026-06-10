// The one workspaces fetch-and-subscribe (U21), replacing the copy in every
// surface that listed workspaces. Refetches when sessionsNonce bumps — the
// signal workspace/session mutations already fire — so a rename or a newly
// opened folder reflects across the rail, pickers, and routes without each
// keeping its own copy of the wiring.
import { useEffect, useState } from 'react'
import { useSession } from './session-store'
import type { Workspace } from '../../electron/main/workspaces/registry'

export function useWorkspaces(): Workspace[] {
  const nonce = useSession((s) => s.sessionsNonce)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  useEffect(() => {
    let live = true
    void window.hearth.workspaces.list().then((l) => live && setWorkspaces(l))
    return () => {
      live = false
    }
  }, [nonce])
  return workspaces
}
