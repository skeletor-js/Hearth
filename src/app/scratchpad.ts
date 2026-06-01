// The Scratchpad: a per-workspace markdown note the user keeps and the agent may
// read. Backed by a real file in the workspace cwd via the existing `files` IPC —
// no dedicated channel. Pure helpers here are unit-tested; the read/write wrappers
// just adapt the bridge.

/** Path of the pad, relative to a workspace cwd. `.hearth/` is gitignored + hidden. */
export const SCRATCHPAD_REL = '.hearth/scratchpad.md'

/** Hard cap — it's for quick notes, not a document. Also bounds auto-attach cost. */
export const SCRATCHPAD_MAX = 4000

/** Clamp note text to the hard cap. */
export function clampScratchpad(text: string): string {
  return text.length > SCRATCHPAD_MAX ? text.slice(0, SCRATCHPAD_MAX) : text
}

/**
 * Prepend the pad to a typed prompt, fenced so user content can't break out: the
 * fence is always longer than the longest backtick run inside the pad (CommonMark
 * rule). A blank pad returns the typed text unchanged.
 */
export function wrapForPrompt(typed: string, pad: string): string {
  if (!pad.trim()) return typed
  const longestTicks = (pad.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0)
  const fence = '`'.repeat(Math.max(3, longestTicks + 1))
  return `${fence}scratchpad\n${pad}\n${fence}\n\n${typed}`
}

/** Read the pad for a workspace; missing/binary/oversized → empty string. */
export async function readScratchpad(cwd: string): Promise<string> {
  try {
    const fc = await window.hearth.files.read(cwd, SCRATCHPAD_REL)
    return fc.readonly ? '' : fc.content
  } catch {
    return ''
  }
}

/** Write the pad for a workspace (clamped). Creates `.hearth/` if absent. */
export async function writeScratchpad(cwd: string, text: string): Promise<void> {
  await window.hearth.files.write(cwd, SCRATCHPAD_REL, clampScratchpad(text))
}
