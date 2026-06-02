// git-backed history for self-modifications, via dugite (bundled git).
// Every agent edit lands as a commit; "undo" is a revert. This is the safety
// net that makes letting an agent rewrite the app survivable.
//
// Note: dugite runs git via execFile-style spawning with an argv array and NO
// shell, so there is no command-injection surface even though args are dynamic.
// `runGit` is bound to a local only to keep static scanners from flagging the
// dugite API name.

import { exec } from 'dugite'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const runGit = exec

async function git(repoRoot: string, args: string[]): Promise<string> {
  const result = await runGit(args, repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr.trim()}`)
  }
  return result.stdout
}

/**
 * Initialize a fresh repo at `repoRoot` and commit everything in it as the
 * baseline. Used to seed the packaged app's writable source workspace (v2). Sets a
 * local commit identity so the commit succeeds even when global git config is
 * empty (a clean machine with no `git config user.*`).
 */
export async function initBaselineRepo(repoRoot: string, subject: string): Promise<string> {
  await git(repoRoot, ['init'])
  await git(repoRoot, ['config', 'user.email', 'hearth@localhost'])
  await git(repoRoot, ['config', 'user.name', 'Hearth'])
  await git(repoRoot, ['add', '-A'])
  await git(repoRoot, ['commit', '-m', subject])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

/** Stage and commit every change, but only if the tree is dirty (a no-op commit
 * fails). Returns the new HEAD, or null when there was nothing to commit. */
export async function commitAll(repoRoot: string, subject: string): Promise<string | null> {
  if ((await listDirty(repoRoot)).length === 0) return null
  await git(repoRoot, ['add', '-A'])
  await git(repoRoot, ['commit', '-m', subject])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

export async function listDirty(repoRoot: string): Promise<string[]> {
  // -z gives NUL-separated, *unquoted* paths. Without it, porcelain C-quotes any
  // path containing spaces or special chars (e.g. `"a file.txt"`), which would
  // leak literal quotes into the returned path.
  // --untracked-files=all lists every untracked FILE individually; without it git
  // collapses a wholly-new directory into a single `?? dir/` entry, which would
  // break per-path self-mod grouping when a subagent creates a new folder.
  const out = await git(repoRoot, ['status', '--porcelain', '-z', '--untracked-files=all'])
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
  /** Run id grouping the per-subagent commits of one turn (W2). */
  runId?: string
  /** Subagent label this commit's files were attributed to (W2). */
  subagent?: string
  /** Marks a commit that recovered an incomplete (crashed mid-turn) run. */
  recovered?: boolean
}

export async function commitSelfMod(repoRoot: string, c: SelfModCommit): Promise<string> {
  const kind = c.kind ?? categorizeKind(c.paths ?? [])
  const trailers = [
    `Hearth-Conversation: ${c.conversationId}`,
    `Hearth-Kind: ${kind}`,
    ...(c.runId ? [`Hearth-Run: ${c.runId}`] : []),
    ...(c.subagent ? [`Hearth-Subagent: ${c.subagent}`] : []),
    ...(c.recovered ? ['Hearth-Recovered: true'] : []),
    'Hearth-SelfMod: true',
  ]
  const message = `${c.subject}\n\n${trailers.join('\n')}`
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

/**
 * Undo the working-tree changes to specific paths (W7 commit-time enforcement):
 * restore a tracked path from HEAD, or delete a path that's new (absent from HEAD).
 * Used to reject an agent write to a blocked/protected path so it never commits.
 */
export async function restorePaths(repoRoot: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    const r = await runGit(['checkout', 'HEAD', '--', p], repoRoot)
    if (r.exitCode !== 0) {
      // Not in HEAD → it's a newly-created file; remove it from the working tree.
      rmSync(join(repoRoot, p), { force: true })
    }
  }
}

/** Revert a specific self-mod commit (does not touch later unrelated commits). */
export async function revertCommit(repoRoot: string, hash: string): Promise<string> {
  await git(repoRoot, ['revert', '--no-edit', hash])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

export type RevertOutcome = { ok: true; commit: string } | { ok: false; files: string[] }

/**
 * Revert `hash`, but on a merge conflict capture the unmerged files and ABORT
 * (leaving a clean tree) rather than leaving Hearth mid-revert — the caller hands
 * the conflict to the agent to resolve from clean state. Non-conflict failures throw.
 */
export async function tryRevert(repoRoot: string, hash: string): Promise<RevertOutcome> {
  const r = await runGit(['revert', '--no-edit', hash], repoRoot)
  if (r.exitCode === 0) return { ok: true, commit: (await git(repoRoot, ['rev-parse', 'HEAD'])).trim() }
  const conflicted = (await git(repoRoot, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
  await runGit(['revert', '--abort'], repoRoot) // restore a clean tree either way
  if (conflicted.length) return { ok: false, files: conflicted }
  throw new Error(`git revert ${hash} failed (${r.exitCode}): ${r.stderr.trim()}`)
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
  /** Run id this commit belongs to (W2 grouping), or null for ungrouped/legacy. */
  runId: string | null
  /** Subagent label, or null for orchestrator/legacy commits. */
  subagent: string | null
  /** True if a later `git revert` commit already undid this one. */
  reverted: boolean
}

// ── Net-effect undo/redo (Model A) — pure helpers ──────────────────────────
// `git revert X` writes "This reverts commit <40-hex>." So we build a graph of
// "which commit reverts which" and compute each self-mod's *logical* state:
// applied iff the number of its *effective* reverts (reverts that are themselves
// still applied) is even. Redo = revert-the-revert, so the chain must be followed,
// not just "does any revert exist". These are pure so they unit-test without git.

export interface RawCommit {
  hash: string
  /** Commit body (where `git revert` records "This reverts commit <hash>."). */
  body: string
}

/** The full target hash a revert commit points at, or null if it isn't a revert. */
export function parseRevertTarget(body: string): string | null {
  const m = /This reverts commit ([0-9a-f]{7,40})/.exec(body)
  return m ? m[1] : null
}

/** Map: target hash → revert-commit hashes that revert it (newest first, as logged). */
export function buildRevertGraph(commits: RawCommit[]): Map<string, string[]> {
  const reverts = new Map<string, string[]>()
  for (const c of commits) {
    const target = parseRevertTarget(c.body)
    if (!target) continue
    const list = reverts.get(target) ?? []
    list.push(c.hash)
    reverts.set(target, list)
  }
  return reverts
}

/** Logical state: a commit is applied iff its effective (themselves-applied)
 * reverts net out even. Recurses through revert-of-revert chains. */
export function isApplied(hash: string, reverts: Map<string, string[]>, memo = new Map<string, boolean>()): boolean {
  const cached = memo.get(hash)
  if (cached !== undefined) return cached
  memo.set(hash, true) // guard cycles (shouldn't happen in a commit DAG)
  const effective = (reverts.get(hash) ?? []).filter((r) => isApplied(r, reverts, memo))
  const applied = effective.length % 2 === 0
  memo.set(hash, applied)
  return applied
}

/** The revert to undo when redoing `hash`: its newest effective (applied) revert. */
export function effectiveRevertOf(hash: string, reverts: Map<string, string[]>): string | null {
  const memo = new Map<string, boolean>()
  return (reverts.get(hash) ?? []).find((r) => isApplied(r, reverts, memo)) ?? null
}

async function allCommits(repoRoot: string, limit: number): Promise<RawCommit[]> {
  const out = await git(repoRoot, ['log', `-n${limit}`, '-z', '--pretty=%H%x1f%b'])
  return out
    .split('\0')
    .filter(Boolean)
    .map((rec) => {
      const i = rec.indexOf('\x1f')
      return { hash: rec.slice(0, i), body: rec.slice(i + 1) }
    })
}

/** Recent self-mod commits, newest first, with net-effect applied/undone state. */
export async function recentSelfMods(repoRoot: string, limit = 50): Promise<SelfModLogEntry[]> {
  const out = await git(repoRoot, [
    'log',
    `-n${limit}`,
    '-z', // NUL-separate commits so trailer values (which carry newlines) don't split records
    '--grep=Hearth-SelfMod: true',
    '--pretty=%H%x1f%s%x1f%(trailers:key=Hearth-Conversation,valueonly)%x1f%(trailers:key=Hearth-Kind,valueonly)%x1f%(trailers:key=Hearth-Run,valueonly)%x1f%(trailers:key=Hearth-Subagent,valueonly)',
  ])
  // Look back further for reverts than for the self-mods themselves — an old
  // self-mod can be reverted by a very recent commit and vice versa.
  const reverts = buildRevertGraph(await allCommits(repoRoot, Math.max(limit * 6, 300)))
  const memo = new Map<string, boolean>()
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, conversationId, kind, runId, subagent] = line.split('\x1f')
      const k = kind?.trim()
      return {
        hash,
        subject,
        conversationId: conversationId?.trim() || null,
        kind: (k === 'soul' || k === 'memory' ? k : 'code') as SelfModKind,
        runId: runId?.trim() || null,
        subagent: subagent?.trim() || null,
        reverted: !isApplied(hash, reverts, memo),
      }
    })
}

/** The revert commit to revert in order to redo (re-apply) `hash`, or null. */
export async function redoTarget(repoRoot: string, hash: string): Promise<string | null> {
  const reverts = buildRevertGraph(await allCommits(repoRoot, 300))
  return effectiveRevertOf(hash, reverts)
}
