// Source-write enforcement (W0b). Detects shell commands that mutate repo source
// outside the agent's Edit/Write tool, and rejects them at permission time (Codex
// + as a universal backstop). This is a heuristic tripwire, NOT the enforcement
// boundary: the commit-time scope guard (self-mod-service) is the real net, and the
// fs-watch overlay is the final backstop for anything that slips through.
//
// Scoped to *hand-edited source* mutation — it deliberately does NOT block reads,
// builds, package installs, or writes to generated/output dirs. Interpreter-based
// writes (node -e "fs.writeFileSync(...)", python -c "open(...,'w')") are also out
// of scope here by design — they're too varied to match without false positives and
// are caught by the commit-time guard. Part of the protected island; dependency-free.

// Commands that write files in place.
const MUTATORS = /\b(sed\s+-i|tee\b|dd\b|truncate\b|install\s+-|patch\b)/
// Redirections into a file: `>path`, `> path`, `>>path`, `1> path` (an optional fd
// digit). Excludes fd duplication (`2>&1`, `&>`, `>&`) and process substitution
// (`>(...)`).
const REDIRECT = /(?:^|[^&\d>])\d?>>?\s*(?![&(])\S/
// File-moving commands.
const MOVERS = /\b(cp|mv|rsync|ln)\s+/

// Paths we protect from un-mediated shell writes (repo source, not build output).
// The boundary class includes `>` so a no-space redirect (`>>src/x`) still counts.
const SOURCE_HINT = /(?:^|[\s'">/])(?:src\/|electron\/|index\.html|package\.json|electron\.vite\.config|tsconfig)/

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
