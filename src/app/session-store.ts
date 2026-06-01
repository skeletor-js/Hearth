import { create } from 'zustand'
import type { PlanEntry } from '../../electron/shared/protocol'

/** The latest self-edit set (what Hearth just changed about itself). */
export interface SelfEdit {
  commit: string
  subject: string
  changedPaths: string[]
  reverted?: boolean
}

// Runtime state for the active session — derived from the agent stream and shared
// between the chat surface and the workbench panels. NOT persisted (unlike the
// shell UI prefs in shell/store.ts); it resets when the session does.
interface SessionState {
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
}

export const useSession = create<SessionState>((set) => ({
  plan: [],
  setPlan: (plan) => set({ plan }),
  diffNonce: 0,
  refreshDiff: () => set((s) => ({ diffNonce: s.diffNonce + 1 })),
  reviewCount: 0,
  setReviewCount: (reviewCount) => set({ reviewCount }),
  lastSelfEdit: null,
  setLastSelfEdit: (lastSelfEdit) => set({ lastSelfEdit }),
}))
