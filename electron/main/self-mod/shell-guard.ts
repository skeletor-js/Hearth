// Source-write enforcement (W0b). Detects shell commands that mutate repo source
// OUTSIDE the mediated Edit/Write path (which the write-broker governs). These are
// rejected so the agent is steered onto the broker, where scope + 3-way-merge
// apply. Used both at permission time (Codex + as a universal backstop) and to
// generate the Claude PreToolUse hook (mode-independent). The fs-watch overlay is
// still the final detection net for anything that slips through.
//
// Scoped to *hand-edited source* mutation — it deliberately does NOT block reads,
// builds, package installs, or writes to generated/output dirs. Part of the
// protected island; dependency-free. See SELF-MOD-HARDENING-PLAN W0b.

// Commands that write files in place.
const MUTATORS = /\b(sed\s+-i|tee\b|dd\b|truncate\b|install\s+-|patch\b)/
// Redirections into a file: `> path`, `>> path` (not `2>&1`, not process subst).
const REDIRECT = /(?:^|[^0-9&>])>>?\s*(?!&)\S/
// File-moving commands.
const MOVERS = /\b(cp|mv|rsync|ln)\s+/

// Paths we protect from un-mediated shell writes (repo source, not build output).
const SOURCE_HINT = /(?:^|[\s'"/])(?:src\/|electron\/|index\.html|package\.json|electron\.vite\.config|tsconfig)/

/**
 * True when `command` looks like it mutates repo source without going through the
 * mediated Edit/Write tool. Heuristic by design — the fs-watch backstop catches
 * the rest. Returns false for reads, builds, installs, and generated-output writes.
 */
export function isSourceMutatingShell(command: string): boolean {
  if (!command) return false
  const c = command.trim()
  // A write only counts if it's an in-place mutator, a file redirect, or a move —
  // reads (cat/grep/ls), builds, installs, and tests have none of these, so they
  // fall through to false even when they mention `src/`.
  const mutates = MUTATORS.test(c) || MOVERS.test(c) || REDIRECT.test(c)
  if (!mutates) return false
  return SOURCE_HINT.test(c)
}
