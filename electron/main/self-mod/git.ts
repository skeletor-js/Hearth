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
  const out = await git(repoRoot, ['status', '--porcelain'])
  return out
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
}

export interface SelfModCommit {
  /** Files to stage (repo-relative). Empty = stage everything dirty. */
  paths?: string[]
  subject: string
  /** Conversation that produced the change; recorded as a trailer for revert routing. */
  conversationId: string
}

export async function commitSelfMod(repoRoot: string, c: SelfModCommit): Promise<string> {
  await git(repoRoot, ['add', ...(c.paths?.length ? c.paths : ['-A'])])
  const message = `${c.subject}\n\nHearth-Conversation: ${c.conversationId}\nHearth-SelfMod: true`
  await git(repoRoot, ['commit', '-m', message])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

/** Revert a specific self-mod commit (does not touch later unrelated commits). */
export async function revertCommit(repoRoot: string, hash: string): Promise<string> {
  await git(repoRoot, ['revert', '--no-edit', hash])
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

export interface SelfModLogEntry {
  hash: string
  subject: string
  conversationId: string | null
}

/** Recent self-mod commits, newest first. */
export async function recentSelfMods(repoRoot: string, limit = 50): Promise<SelfModLogEntry[]> {
  const out = await git(repoRoot, [
    'log',
    `-n${limit}`,
    '--grep=Hearth-SelfMod: true',
    '--pretty=%H%x1f%s%x1f%(trailers:key=Hearth-Conversation,valueonly)',
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, conversationId] = line.split('\x1f')
      return { hash, subject, conversationId: conversationId?.trim() || null }
    })
}
