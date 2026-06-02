// A tiny bus so other surfaces (e.g. guided connector setup) can drop a command
// into the Terminal tab. The command is TYPED into the live PTY but NOT submitted
// — the user reviews it and presses Enter. Not persisted; mounted terminals
// consume-once so a queued command runs in a single terminal.

import { create } from 'zustand'

interface TerminalBus {
  pending: string | null
  /** Open intent: type this command into the next available terminal. */
  run: (command: string) => void
  /** Take the pending command (clears it) — returns null if none. */
  take: () => string | null
}

export const useTerminalBus = create<TerminalBus>((set, get) => ({
  pending: null,
  run: (command) => set({ pending: command }),
  take: () => {
    const c = get().pending
    if (c !== null) set({ pending: null })
    return c
  },
}))
