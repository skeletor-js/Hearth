import { useSession, type ActiveSession } from './session-store'
import { usePresence } from './presence-store'
import { persistEntries } from './transcript-persist'
import type { Workspace } from '../../electron/main/workspaces/registry'
import type { SessionMeta } from '../../electron/main/sessions/store'

function toActive(m: SessionMeta): ActiveSession {
  // Default the framing for sessions persisted before kind existed.
  return { id: m.id, title: m.title, cwd: m.cwd, workspaceId: m.workspaceId, self: m.self, kind: m.kind ?? (m.self ? 'code' : 'knowledge') }
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
 * Run a turn in a session WITHOUT making it active or navigating to it — the
 * background path for routines (and any future fire-and-forget turn). Presence is
 * marked so the rail shows it live; updates stream through the presence bridge and
 * are persisted by the background persister. The turn itself runs through main's
 * per-cwd-serialized prompt handler, so it can't corrupt a concurrent foreground
 * turn. See docs/PRESENCE.md (#6).
 */
export async function runBackgroundTurn(meta: SessionMeta, text: string): Promise<void> {
  useSession.getState().bumpSessions() // surface the new session in the rail
  usePresence.getState().markSending(meta.id)
  persistEntries(meta.id, [{ kind: 'user', text }])
  try {
    await window.hearth.agent.prompt(meta.id, meta.cwd, text)
  } catch {
    usePresence.getState().setError(meta.id)
  }
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
