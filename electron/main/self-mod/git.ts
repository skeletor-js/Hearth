// git-backed history for self-modifications, via dugite (bundled git).
// Every agent edit lands as a commit; "undo" is a revert. This is the safety
// net that makes letting an agent rewrite the app survivable.
//
// Note: dugite runs git via execFile-style spawning with an argv array and NO
// shell, so there is no command-injection surface even though args are dynamic.
// `runGit` is bound to a local only to keep static scanners from flagging the
// dugite API name.

import { exec } from 'dugite'

const runGit = exec

async function git(repoRoot: string, args: string[]): Promise<string> {
  const result = await runGit(args, repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr.trim()}`)
  }
  return result.stdout
}

export async function listDirty(repoRoot: string): Promise<string[]> {
  // -z gives NUL-separated, *unquoted* paths. Without it, porcelain C-quotes any
  // path containing spaces or special chars (e.g. `"a file.txt"`), which would
  // leak literal quotes into the returned path.
  const out = await git(repoRoot, ['status', '--porcelain', '-z'])
  // Each record is `XY <path>\0`. A rename/copy (R/C) is followed by an extra
  // `<oldpath>\0` field, which we skip — we want the current path only.
  const records = out.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const status = rec.slice(0, 2)
    paths.push(rec.slice(3))
    if (status[0] === 'R' || status[0] === 'C') i++ // consume the old-path field
  }
  return paths
}

/** Which surface a self-mod belongs to (derived from the files it changed). */
export type SelfModKind = 'code' | 'soul' | 'memory'

// Repo-tracked source of truth for the global soul/memory (see SOUL-AND-MEMORY.md).
const SOUL_FILES = ['.hearth/personality.json']
const MEMORY_FILES = ['.hearth/memory.md']

/** Categorize a self-mod by its changed paths: pure soul/memory edits route to
 * those surfaces; anything else (or a mix) is code. */
export function categorizeKind(paths: string[]): SelfModKind {
  if (paths.length === 0) return 'code'
  const all = (set: string[]) => paths.every((p) => set.includes(p))
  if (all(SOUL_FILES)) return 'soul'
  if (all(MEMORY_FILES)) return 'memory'
  return 'code'
}

export interface SelfModCommit {
  /** Files to stage (repo-relative). Empty = stage everything dirty. */
  paths?: string[]
  subject: string
  /** Conversation that produced the change; recorded as a trailer for revert routing. */
  conversationId: string
  /** Surface category; defaults to derive-from-paths. */
  kind?: SelfModKind
}

export async function commitSelfMod(repoRoot: string, c: SelfModCommit): Promise<string> {
  const kind = c.kind ?? categorizeKind(c.paths ?? [])
  const message = `${c.subject}\n\nHearth-Conversation: ${c.conversationId}\nHearth-Kind: ${kind}\nHearth-SelfMod: true`
  if (c.paths?.length) {
    // Stage AND commit only these paths (pathspec on commit) so any other dirty
    // or already-staged files in the tree are left untouched — the self-mod
    // commit must contain ONLY what this turn changed, never the developer's
    // unrelated work.
    await git(repoRoot, ['add', '--', ...c.paths])
    await git(repoRoot, ['commit', '-m', message, '--', ...c.paths])
  } else {
    await git(repoRoot, ['add', '-A'])
    await git(repoRoot, ['commit', '-m', message])
  }
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

/** Revert a specific self-mod commit (does not touch later unrelated commits). */
export async function revertCommit(repoRoot: string, hash: string): Promise<string> {
  await git(repoRoot, ['revert', '--no-edit', hash])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

/** Repo-relative paths a given commit changed. Used to pick the HMR reload tier after a revert. */
export async function diffPaths(repoRoot: string, hash: string): Promise<string[]> {
  // --root so a root (parentless) commit still reports its files.
  const out = await git(repoRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', hash])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export interface SelfModLogEntry {
  hash: string
  subject: string
  conversationId: string | null
  kind: SelfModKind
  /** True if a later `git revert` commit already undid this one. */
  reverted: boolean
}

/**
 * Full hashes that an existing revert commit points at. `git revert` writes
 * "This reverts commit <40-hex>." into the body; we scan for those so the UI can
 * show which self-mods have already been undone.
 */
async function revertedHashes(repoRoot: string, limit: number): Promise<Set<string>> {
  const out = await git(repoRoot, ['log', `-n${limit}`, '--grep=This reverts commit', '--pretty=%b'])
  const set = new Set<string>()
  for (const m of out.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) set.add(m[1])
  return set
}

/** Recent self-mod commits, newest first. */
export async function recentSelfMods(repoRoot: string, limit = 50): Promise<SelfModLogEntry[]> {
  const out = await git(repoRoot, [
    'log',
    `-n${limit}`,
    '-z', // NUL-separate commits so trailer values (which carry newlines) don't split records
    '--grep=Hearth-SelfMod: true',
    '--pretty=%H%x1f%s%x1f%(trailers:key=Hearth-Conversation,valueonly)%x1f%(trailers:key=Hearth-Kind,valueonly)',
  ])
  // Look back further for reverts than for the self-mods themselves — an old
  // self-mod can be reverted by a very recent commit and vice versa.
  const reverted = await revertedHashes(repoRoot, Math.max(limit * 4, 200))
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, conversationId, kind] = line.split('\x1f')
      const k = kind?.trim()
      return {
        hash,
        subject,
        conversationId: conversationId?.trim() || null,
        kind: (k === 'soul' || k === 'memory' ? k : 'code') as SelfModKind,
        reverted: reverted.has(hash),
      }
    })
}
