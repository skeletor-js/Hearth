// Idempotent managed-block editing for instruction files. Hearth owns a delimited
// region inside a file the agent natively reads (Claude's CLAUDE.md, Codex's
// AGENTS.md) and leaves everything else — the user's own content — untouched and
// reversible. Pure string transforms so they unit-test without the filesystem.

const OPEN = (id: string) => `<!-- HEARTH:${id} — generated, do not edit by hand -->`
const CLOSE = (id: string) => `<!-- /HEARTH:${id} -->`

function blockRegex(id: string): RegExp {
  // Match the open marker, everything between, and the close marker (incl. a
  // trailing newline). `id` is a fixed internal literal, but escape defensively.
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\n*<!-- HEARTH:${esc}[^\\n]*-->\\n[\\s\\S]*?\\n<!-- /HEARTH:${esc} -->\\n*`, 'g')
}

/** Read the body of a managed block, or null if absent. */
export function readBlock(content: string, id: string): string | null {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`<!-- HEARTH:${esc}[^\\n]*-->\\n([\\s\\S]*?)\\n<!-- /HEARTH:${esc} -->`).exec(content)
  return m ? m[1] : null
}

/**
 * Insert or replace the managed block in `content`. An empty/whitespace `body`
 * removes the block entirely. Returns the new file content. Surrounding content
 * is preserved; the block is appended (with a separating blank line) if absent.
 */
export function upsertBlock(content: string, id: string, body: string): string {
  const stripped = content.replace(blockRegex(id), '\n').replace(/\n{3,}/g, '\n\n')
  const trimmed = stripped.replace(/\s+$/, '')
  if (!body.trim()) return trimmed ? trimmed + '\n' : ''
  const block = `${OPEN(id)}\n${body.trim()}\n${CLOSE(id)}`
  return (trimmed ? trimmed + '\n\n' : '') + block + '\n'
}
