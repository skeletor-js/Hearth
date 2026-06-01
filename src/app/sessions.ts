import { useSession, type ActiveSession } from './session-store'
import type { Workspace } from '../../electron/main/workspaces/registry'
import type { SessionMeta } from '../../electron/main/sessions/store'

function toActive(m: SessionMeta): ActiveSession {
  return { id: m.id, title: m.title, cwd: m.cwd, workspaceId: m.workspaceId, self: m.self }
}

/** Create a fresh session in a workspace and make it active. */
export async function startSession(ws: Workspace): Promise<ActiveSession> {
  const meta = await window.hearth.sessions.create({ workspaceId: ws.id, cwd: ws.path, self: ws.isHearth })
  const active = toActive(meta)
  useSession.getState().setActive(active)
  useSession.getState().bumpSessions()
  return active
}

/** Make an existing session active (opens its transcript). */
export function openSession(m: SessionMeta): ActiveSession {
  const active = toActive(m)
  useSession.getState().setActive(active)
  return active
}

/**
 * Ensure there's an active session: resume the most recent one, else start a
 * fresh Hearth session. Called when entering the chat with nothing selected.
 */
export async function ensureActiveSession(): Promise<ActiveSession> {
  const current = useSession.getState().active
  if (current) return current
  const list = await window.hearth.sessions.list()
  if (list.length > 0) return openSession(list[0])
  const workspaces = await window.hearth.workspaces.list()
  const hearth = workspaces.find((w) => w.isHearth) ?? workspaces[0]
  return startSession(hearth)
}
