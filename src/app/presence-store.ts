import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { PermissionRequest, SessionUpdate } from '../../electron/shared/protocol'

// sessionStorage in the renderer; an inert in-memory shim under test/SSR (no global
// sessionStorage there) so persist stays a no-op instead of throwing.
const NOOP_STORAGE: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const presenceStorage = (): StateStorage => (typeof sessionStorage !== 'undefined' ? sessionStorage : NOOP_STORAGE)

// Per-session presence — the coarse "what is this agent doing right now" state the
// shell renders ambiently (rail dots, the living flame, "waiting on you", the
// "while you were away" recap), derived from the agent's SessionUpdate stream.
//
// Persisted to sessionStorage so it survives a self-mod renderer reload (the morph)
// WITHOUT surviving a real app restart — sessionStorage is cleared on a fresh
// process, so we never resurrect stale presence across launches. On rehydrate we
// sanitize transient live status (thinking/working → idle): a self-mod reload
// happens at a turn boundary, so if a turn is genuinely still streaming the bridge
// re-sets it within a tick; this just avoids a stuck-busy state if an 'end' update
// landed in the reload gap. The recap data (recentFiles, edits, finishedAt, unread)
// and any pending permission are preserved. See docs/PRESENCE.md (P0, P5).

export type PresenceStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'done'

/** A file the agent touched this run, with the changed line range (1-based, inclusive)
 * when known — drives the editor change-reveal (P7) and the file pulse (P4). */
export interface RecentFile {
  path: string
  range?: [number, number]
  at: number
}

export interface SessionPresence {
  status: PresenceStatus
  /** Human label for the current activity, e.g. "editing FilesTab.tsx". */
  label: string | null
  recentFiles: RecentFile[]
  /** A permission ask blocking this session — the tap-on-the-shoulder signal (P2). */
  pendingPermission: PermissionRequest | null
  /** Files edited this run, for the "while you were away" recap (P5). */
  edits: number
  startedAt: number | null
  finishedAt: number | null
  /** Finished while this session was NOT the active one — drives the recap chip. */
  unread: boolean
  /** This run was started headless (routine runner) — its permission asks fail
   * closed instead of waiting on a user who isn't there (U7). */
  backgroundRun: boolean
  /** Why this run needs a human look (e.g. a fail-closed permission denial).
   * Survives the turn ending — "done" is not the whole story. */
  needsAttention: string | null
}

export const FRESH_PRESENCE: SessionPresence = {
  status: 'idle',
  label: null,
  recentFiles: [],
  pendingPermission: null,
  edits: 0,
  startedAt: null,
  finishedAt: null,
  unread: false,
  backgroundRun: false,
  needsAttention: null,
}

const RECENT_MAX = 12

/** Compute the changed line range (1-based, inclusive, in new-text coordinates) from a
 * diff's old/new text by trimming the common prefix and suffix. Returns undefined when
 * nothing meaningfully changed. A brand-new file (oldText null) spans all its lines. */
export function changedRange(oldText: string | null, newText: string): [number, number] | undefined {
  const next = newText.split('\n')
  if (oldText == null) return next.length ? [1, next.length] : undefined
  const prev = oldText.split('\n')
  let start = 0
  const maxPrefix = Math.min(prev.length, next.length)
  while (start < maxPrefix && prev[start] === next[start]) start++
  let endPrev = prev.length - 1
  let endNext = next.length - 1
  while (endPrev >= start && endNext >= start && prev[endPrev] === next[endNext]) {
    endPrev--
    endNext--
  }
  // No additions in the new text (pure deletion) — anchor a single 1-based line
  // marker at the line that now follows the removed region (clamped to the file).
  if (endNext < start) {
    const at = Math.min(start + 1, Math.max(1, next.length))
    return [at, at]
  }
  return [start + 1, endNext + 1]
}

interface PresenceState {
  byId: Record<string, SessionPresence>
  /** A prompt was just sent — optimistically mark the session working and start a
   * fresh run (resets this-run counters) so the UI doesn't flash idle before the
   * first stream event lands. */
  markSending: (id: string) => void
  /** Fold one stream update into a session's presence. `isActive` decides whether a
   * turn that ends counts as unread (finished while the user was looking elsewhere). */
  applyUpdate: (id: string, u: SessionUpdate, isActive: boolean) => void
  setPermission: (id: string, req: PermissionRequest | null) => void
  /** Mark a session's current turn as headless (routine-driven) — see U7. */
  markBackgroundRun: (id: string) => void
  /** Record that this run declined something unattended and needs a look. */
  flagAttention: (id: string, reason: string) => void
  setError: (id: string) => void
  /** Settle a just-finished session from its brief 'done' flash back to idle. */
  settle: (id: string) => void
  clearUnread: (id: string) => void
}

const patch = (
  set: (fn: (s: PresenceState) => Partial<PresenceState>) => void,
  id: string,
  fn: (p: SessionPresence) => SessionPresence,
) => set((s) => ({ byId: { ...s.byId, [id]: fn(s.byId[id] ?? FRESH_PRESENCE) } }))

export const usePresence = create<PresenceState>()(
  persist(
    (set) => ({
      byId: {},

  markSending: (id) =>
    patch(set, id, (p) => ({
      ...p,
      status: 'thinking',
      label: null,
      recentFiles: [],
      pendingPermission: null,
      edits: 0,
      startedAt: Date.now(),
      finishedAt: null,
      unread: false,
      // A new turn starts interactive until the runner marks it otherwise;
      // needsAttention survives (it's about a PRIOR run the user hasn't seen).
      backgroundRun: false,
    })),

  applyUpdate: (id, u, isActive) =>
    patch(set, id, (p) => {
      switch (u.type) {
        case 'message':
        case 'thought':
          // Don't override a blocking permission ask with streamed reasoning.
          if (p.status === 'waiting') return p
          return { ...p, status: 'thinking', startedAt: p.startedAt ?? Date.now() }
        case 'tool-call': {
          if (u.status === 'error') return { ...p, status: 'error', label: u.title }
          if (u.status === 'done') return p.status === 'waiting' ? p : { ...p, status: 'working' }
          return { ...p, status: p.status === 'waiting' ? 'waiting' : 'working', label: u.title }
        }
        case 'diff': {
          const rf: RecentFile = { path: u.path, range: changedRange(u.oldText, u.newText), at: Date.now() }
          return { ...p, recentFiles: [...p.recentFiles, rf].slice(-RECENT_MAX), edits: p.edits + 1 }
        }
        case 'end':
          // unread already set mid-turn (e.g. a fail-closed denial, U7) survives
          // the turn ending — don't recompute it away.
          return { ...p, status: 'done', label: null, finishedAt: Date.now(), unread: p.unread || (!isActive && p.edits > 0) }
        default:
          return p
      }
    }),

  setPermission: (id, req) =>
    patch(set, id, (p) => ({ ...p, pendingPermission: req, status: req ? 'waiting' : p.status === 'waiting' ? 'working' : p.status })),

  markBackgroundRun: (id) => patch(set, id, (p) => ({ ...p, backgroundRun: true })),

  flagAttention: (id, reason) => patch(set, id, (p) => ({ ...p, needsAttention: reason, unread: true })),

  // A dead agent can't act on an answer, so any pending ask is cleared with the
  // error rather than left dangling as a ghost ApproveCard (U5).
  setError: (id) => patch(set, id, (p) => ({ ...p, status: 'error', pendingPermission: null, finishedAt: Date.now() })),

  settle: (id) => patch(set, id, (p) => (p.status === 'done' ? { ...p, status: 'idle' } : p)),

  clearUnread: (id) => patch(set, id, (p) => ({ ...p, unread: false })),
    }),
    {
      name: 'hearth-presence',
      storage: createJSONStorage(presenceStorage),
      partialize: (s) => ({ byId: s.byId }),
      // Sanitize transient live status carried across a reload — a mid-flight turn's
      // bridge will re-set it within a tick; this prevents a stuck-busy session if an
      // 'end' update landed during the reload gap.
      merge: (persisted, current) => {
        const saved = (persisted as { byId?: Record<string, SessionPresence> } | undefined)?.byId ?? {}
        const byId: Record<string, SessionPresence> = {}
        for (const [id, p] of Object.entries(saved)) {
          byId[id] = p.status === 'thinking' || p.status === 'working' ? { ...p, status: 'idle' } : p
        }
        return { ...current, byId }
      },
    },
  ),
)

/** Non-reactive read for imperative call sites. */
export const getPresence = (id: string | undefined): SessionPresence =>
  (id ? usePresence.getState().byId[id] : undefined) ?? FRESH_PRESENCE
