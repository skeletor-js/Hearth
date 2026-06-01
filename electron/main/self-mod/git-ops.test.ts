import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'dugite'
import { branches, commit, parseStatus, stage, status, switchBranch } from './git-ops.js'

test('parseStatus reads branch, ahead/behind, and staged/unstaged files', () => {
  const out = '## main...origin/main [ahead 2, behind 1]\0M  staged.ts\0 M dirty.ts\0?? new.ts\0'
  const s = parseStatus(out)
  expect(s.branch).toBe('main')
  expect(s.ahead).toBe(2)
  expect(s.behind).toBe(1)
  expect(s.files).toHaveLength(3)

  const staged = s.files.find((f) => f.path === 'staged.ts')!
  expect(staged.staged).toBe(true)
  expect(staged.tag).toBe('modified')

  const dirty = s.files.find((f) => f.path === 'dirty.ts')!
  expect(dirty.staged).toBe(false)
  expect(dirty.unstaged).toBe(true)

  const untracked = s.files.find((f) => f.path === 'new.ts')!
  expect(untracked.tag).toBe('untracked')
  expect(untracked.staged).toBe(false)
})

test('parseStatus captures rename old path', () => {
  const out = '## main\0R  new.ts\0old.ts\0'
  const s = parseStatus(out)
  expect(s.files[0].tag).toBe('renamed')
  expect(s.files[0].path).toBe('new.ts')
  expect(s.files[0].oldPath).toBe('old.ts')
})

test('parseStatus handles a fresh repo with no commits', () => {
  const out = '## No commits yet on main\0?? a.ts\0'
  const s = parseStatus(out)
  expect(s.branch).toBe('main')
  expect(s.files[0].tag).toBe('untracked')
})

// ── integration: real git ops in a throwaway repo ──────────────────────────
let repo: string
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'hearth-gitops-'))
  const run = async (args: string[]) => {
    const r = await exec(args, repo)
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  await run(['init', '-b', 'main'])
  await run(['config', 'user.email', 'test@hearth.dev'])
  await run(['config', 'user.name', 'Hearth Test'])
  await writeFile(join(repo, 'seed.txt'), 'seed\n')
  await run(['add', '-A'])
  await run(['commit', '-m', 'seed'])
})
afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true })
})

test('stage → commit moves a new file out of the working tree', async () => {
  await writeFile(join(repo, 'feature.txt'), 'hello\n')
  let s = await status(repo)
  expect(s.files.some((f) => f.path === 'feature.txt' && f.tag === 'untracked')).toBe(true)

  await stage(repo, ['feature.txt'])
  s = await status(repo)
  expect(s.files.find((f) => f.path === 'feature.txt')!.staged).toBe(true)

  const hash = await commit(repo, 'add feature')
  expect(hash).toMatch(/^[0-9a-f]{40}$/)
  s = await status(repo)
  expect(s.files).toHaveLength(0)
})

test('create + switch branch', async () => {
  await switchBranch(repo, 'feature/x', true)
  let b = await branches(repo)
  expect(b.current).toBe('feature/x')
  expect(b.branches).toContain('main')

  await switchBranch(repo, 'main')
  b = await branches(repo)
  expect(b.current).toBe('main')
})
