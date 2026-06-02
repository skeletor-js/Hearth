import { create } from 'zustand'
import type { PlanEntry } from '../../electron/shared/protocol'

/** The latest self-edit set (what Hearth just changed about itself). */
export interface SelfEdit {
  commit: string
  subject: string
  changedPaths: string[]
  reverted?: boolean
}

/** The conversation currently shown in the chat surface. */
export interface ActiveSession {
  id: string
  title: string
  cwd: string
  workspaceId: string
  /** True when this session targets the Hearth repo itself. */
  self: boolean
}

// Runtime state for the active session — derived from the agent stream and shared
// between the chat surface and the workbench panels. NOT persisted (unlike the
// shell UI prefs in shell/store.ts); session content persists in main's store.
interface SessionState {
  active: ActiveSession | null
  /** Switch the active session, resetting all per-session derived state. */
  setActive: (a: ActiveSession | null) => void

  plan: PlanEntry[]
  setPlan: (plan: PlanEntry[]) => void

  /** Bumped when the working tree likely changed, so Review can re-fetch. */
  diffNonce: number
  refreshDiff: () => void

  /** Changed-file count, published by Review for the tab badge. */
  reviewCount: number
  setReviewCount: (n: number) => void

  /** The most recent self-edit set, surfaced in the Self tab. */
  lastSelfEdit: SelfEdit | null
  setLastSelfEdit: (e: SelfEdit | null) => void

  /** Bumped after session list mutations so the rail/recents re-fetch. */
  sessionsNonce: number
  bumpSessions: () => void

  /** Bumped to pulse the composer's workspace chip (signals it's changeable after
   * a New Session starts in the current workspace). */
  workspaceFlashNonce: number
  flashWorkspaceChip: () => void

  /** A prompt queued from elsewhere (e.g. History conflict) for the chat to send. */
  pendingPrompt: string | null
  setPendingPrompt: (p: string | null) => void

  /**
   * A "send now" request from outside the chat (e.g. the Scratchpad's Send button).
   * Unlike `pendingPrompt` (consumed only on session load), the chat watches the
   * bumping `nonce` and sends immediately through its normal send path.
   */
  promptRequest: { text: string; nonce: number } | null
  requestPrompt: (text: string) => void

  /** Whether the active workspace's scratchpad has content — drives the composer chip. */
  scratchpadNonEmpty: boolean
  setScratchpadNonEmpty: (v: boolean) => void

  /** Text pushed into the composer for editing/resend (e.g. "edit" a past prompt). */
  composerDraft: string | null
  setComposerDraft: (t: string | null) => void
}

export const useSession = create<SessionState>((set, get) => ({
  active: null,
  setActive: (active) =>
    set({ active, plan: [], reviewCount: 0, lastSelfEdit: null, scratchpadNonEmpty: false, diffNonce: get().diffNonce + 1 }),

  plan: [],
  setPlan: (plan) => set({ plan }),

  diffNonce: 0,
  refreshDiff: () => set((s) => ({ diffNonce: s.diffNonce + 1 })),

  reviewCount: 0,
  setReviewCount: (reviewCount) => set({ reviewCount }),

  lastSelfEdit: null,
  setLastSelfEdit: (lastSelfEdit) => set({ lastSelfEdit }),

  sessionsNonce: 0,
  bumpSessions: () => set((s) => ({ sessionsNonce: s.sessionsNonce + 1 })),

  workspaceFlashNonce: 0,
  flashWorkspaceChip: () => set((s) => ({ workspaceFlashNonce: s.workspaceFlashNonce + 1 })),

  pendingPrompt: null,
  setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),

  promptRequest: null,
  requestPrompt: (text) => set((s) => ({ promptRequest: { text, nonce: (s.promptRequest?.nonce ?? 0) + 1 } })),

  scratchpadNonEmpty: false,
  setScratchpadNonEmpty: (scratchpadNonEmpty) => set({ scratchpadNonEmpty }),

  composerDraft: null,
  setComposerDraft: (composerDraft) => set({ composerDraft }),
}))
