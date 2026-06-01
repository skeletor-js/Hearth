// Working-tree git operations for the workbench's Environment & git surface and
// Review's Draft PR. Operates on the active workspace cwd. Pure parsing
// (`parseStatus`) is split out for unit testing; mutating ops are thin wrappers
// over dugite. PR creation uses `gh` when present, else returns the command for
// the user to run (we never auto-create remote PRs silently).

import { exec } from 'dugite'

const runGit = exec

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr.trim()}`)
  }
  return result.stdout
}

export type FileTag = 'new' | 'modified' | 'deleted' | 'renamed' | 'untracked'
export interface StatusFile {
  path: string
  oldPath?: string
  tag: FileTag
  staged: boolean
  /** True when the working tree has changes not yet staged. */
  unstaged: boolean
}
export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: StatusFile[]
}

function tagFor(x: string, y: string): FileTag {
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'A' || y === 'A') return 'new'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'R') return 'renamed'
  return 'modified'
}

/** Parse `git status --porcelain=v1 -z -b` output. Pure — no I/O. */
export function parseStatus(out: string): GitStatus {
  const records = out.split('\0')
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const files: StatusFile[] = []

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (rec === '') continue
    if (rec.startsWith('## ')) {
      const head = rec.slice(3)
      // `branch...remote [ahead 1, behind 2]` or `No commits yet on branch`
      const name = head.split('...')[0].split(' ')[0]
      branch = name === '' || head.startsWith('No commits') ? head.replace(/^No commits yet on /, '') : name
      const a = /ahead (\d+)/.exec(head)
      const b = /behind (\d+)/.exec(head)
      if (a) ahead = Number(a[1])
      if (b) behind = Number(b[1])
      continue
    }
    const x = rec[0]
    const y = rec[1]
    const path = rec.slice(3)
    const file: StatusFile = {
      path,
      tag: tagFor(x, y),
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' ' && y !== '?' ? true : x === '?',
    }
    if (x === 'R' || x === 'C') {
      file.oldPath = records[++i] // rename/copy: next record is the source path
    }
    files.push(file)
  }
  return { branch, ahead, behind, files }
}

export async function status(cwd: string): Promise<GitStatus> {
  return parseStatus(await git(cwd, ['status', '--porcelain=v1', '-z', '-b']))
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, paths.length ? ['add', '--', ...paths] : ['add', '-A'])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ['restore', '--staged', '--', ...paths])
}

/** Commit currently-staged changes. Returns the new commit hash. */
export async function commit(cwd: string, message: string): Promise<string> {
  await git(cwd, ['commit', '-m', message])
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

export interface BranchInfo {
  current: string | null
  branches: string[]
}

export async function branches(cwd: string): Promise<BranchInfo> {
  const out = await git(cwd, ['branch', '--format=%(refname:short)'])
  const list = out.split('\n').map((l) => l.trim()).filter(Boolean)
  const cur = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return { current: cur === 'HEAD' ? null : cur, branches: list }
}

/** Switch to `name`, creating it (from current HEAD) when `create` is set. */
export async function switchBranch(cwd: string, name: string, create = false): Promise<void> {
  await git(cwd, create ? ['switch', '-c', name] : ['switch', name])
}

export interface PrResult {
  created: boolean
  /** PR url when created via gh, else the command the user can run. */
  detail: string
}

async function hasGh(cwd: string): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  return new Promise((resolve) => {
    execFile('gh', ['--version'], { cwd }, (err) => resolve(!err))
  })
}

/**
 * Create a PR for the current branch. Uses `gh pr create` when the GitHub CLI is
 * available; otherwise returns the command for the user to run themselves (we do
 * not perform the network publish step without `gh`).
 */
export async function createPr(cwd: string, title: string, body: string): Promise<PrResult> {
  if (!(await hasGh(cwd))) {
    const cmd = `gh pr create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`
    return { created: false, detail: cmd }
  }
  const { execFile } = await import('node:child_process')
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'create', '--title', title, '--body', body],
      { cwd },
      (err, stdout, stderr) => {
        if (err) resolve({ created: false, detail: String(stderr || err.message).trim() })
        else resolve({ created: true, detail: stdout.trim() })
      },
    )
  })
}
