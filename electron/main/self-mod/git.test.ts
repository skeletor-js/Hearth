import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// dugite's exec takes an argv array + cwd and spawns git with NO shell, so this
// is not child_process.exec and has no injection surface. Aliased for clarity.
import { exec as gitExec } from 'dugite'

import {
  listDirty,
  commitSelfMod,
  revertCommit,
  recentSelfMods,
  diffPaths,
  categorizeKind,
} from './git'

describe('categorizeKind', () => {
  test('routes pure soul/memory edits, else code', () => {
    expect(categorizeKind(['.hearth/personality.json'])).toBe('soul')
    expect(categorizeKind(['.hearth/memory.md'])).toBe('memory')
    expect(categorizeKind(['src/app/chat/ChatView.tsx'])).toBe('code')
    expect(categorizeKind(['.hearth/personality.json', 'src/x.ts'])).toBe('code') // mixed → code
    expect(categorizeKind([])).toBe('code')
  })
})

describe('Hearth-Kind trailer round-trips', () => {
  test('a soul commit is tagged and parsed as soul', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'hearth-kind-'))
    const run = (args: string[]) => gitExec(args, repo)
    await run(['init', '-b', 'main'])
    await run(['config', 'user.email', 't@h.dev'])
    await run(['config', 'user.name', 'T'])
    mkdirSync(join(repo, '.hearth'), { recursive: true })
    writeFileSync(join(repo, '.hearth/personality.json'), '{}\n')
    await commitSelfMod(repo, { paths: ['.hearth/personality.json'], subject: 'personality', conversationId: 'c1' })
    const mods = await recentSelfMods(repo)
    expect(mods[0].kind).toBe('soul')
    rmSync(repo, { recursive: true, force: true })
  })
})

// Thin fixture helper: run git in the temp repo, throw on failure.
async function run(repo: string, args: string[]): Promise<string> {
  const r = await gitExec(args, repo)
  if (r.exitCode !== 0) {
    throw new Error(`fixture git ${args.join(' ')} failed (${r.exitCode}): ${r.stderr.trim()}`)
  }
  return r.stdout
}

async function head(repo: string): Promise<string> {
  return (await run(repo, ['rev-parse', 'HEAD'])).trim()
}

async function logSubjects(repo: string): Promise<string[]> {
  const out = await run(repo, ['log', '--pretty=%s'])
  return out.split('\n').filter(Boolean)
}

let repo: string

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hearth-git-test-'))
  await run(repo, ['init', '--initial-branch=main'])
  await run(repo, ['config', 'user.name', 'Test'])
  await run(repo, ['config', 'user.email', 'test@example.com'])
  await run(repo, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'baseline.txt'), 'baseline\n')
  await run(repo, ['add', '-A'])
  await run(repo, ['commit', '-m', 'baseline'])
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('listDirty', () => {
  test('returns empty when clean', async () => {
    expect(await listDirty(repo)).toEqual([])
  })

  test('lists untracked files', async () => {
    writeFileSync(join(repo, 'new.txt'), 'x\n')
    expect(await listDirty(repo)).toEqual(['new.txt'])
  })

  test('lists modified tracked files', async () => {
    writeFileSync(join(repo, 'baseline.txt'), 'changed\n')
    expect(await listDirty(repo)).toEqual(['baseline.txt'])
  })

  test('lists staged files', async () => {
    writeFileSync(join(repo, 'staged.txt'), 'x\n')
    await run(repo, ['add', 'staged.txt'])
    expect(await listDirty(repo)).toEqual(['staged.txt'])
  })

  test('handles paths with spaces', async () => {
    writeFileSync(join(repo, 'a file.txt'), 'x\n')
    expect(await listDirty(repo)).toEqual(['a file.txt'])
  })

  test('lists multiple dirty entries', async () => {
    writeFileSync(join(repo, 'baseline.txt'), 'changed\n')
    writeFileSync(join(repo, 'untracked.txt'), 'x\n')
    expect((await listDirty(repo)).sort()).toEqual(['baseline.txt', 'untracked.txt'])
  })

  test('handles a renamed/staged entry', async () => {
    // git records a rename as `R  old -> new` in porcelain v1.
    await run(repo, ['mv', 'baseline.txt', 'renamed.txt'])
    const dirty = await listDirty(repo)
    expect(dirty.length).toBe(1)
    // The entry should reference the new path. We do not require the wrapper to
    // split the rename arrow; we only assert it surfaces the rename without
    // dropping it or mangling it into an empty string.
    expect(dirty[0]).toContain('renamed.txt')
  })
})

describe('commitSelfMod', () => {
  test('creates a commit with subject and both trailers, returns new HEAD', async () => {
    writeFileSync(join(repo, 'feature.txt'), 'work\n')
    const hash = await commitSelfMod(repo, {
      subject: 'add feature',
      conversationId: 'conv-123',
    })

    expect(hash).toBe(await head(repo))

    const body = (await run(repo, ['log', '-1', '--pretty=%B'])).trim()
    expect(body).toContain('add feature')
    expect(body).toContain('Hearth-Conversation: conv-123')
    expect(body).toContain('Hearth-SelfMod: true')
  })

  test('default stages all dirty files (-A)', async () => {
    writeFileSync(join(repo, 'one.txt'), '1\n')
    writeFileSync(join(repo, 'two.txt'), '2\n')
    await commitSelfMod(repo, { subject: 'all', conversationId: 'c' })

    expect(await listDirty(repo)).toEqual([])
    const hash = await head(repo)
    expect((await diffPaths(repo, hash)).sort()).toEqual(['one.txt', 'two.txt'])
  })

  test('paths option stages only the specified files', async () => {
    writeFileSync(join(repo, 'keep.txt'), 'k\n')
    writeFileSync(join(repo, 'leave.txt'), 'l\n')
    const hash = await commitSelfMod(repo, {
      subject: 'partial',
      conversationId: 'c',
      paths: ['keep.txt'],
    })

    expect(await diffPaths(repo, hash)).toEqual(['keep.txt'])
    // leave.txt remains untracked/dirty.
    expect(await listDirty(repo)).toEqual(['leave.txt'])
  })
})

describe('recentSelfMods', () => {
  test('returns only self-mod commits, newest first, with parsed conversationId', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    await commitSelfMod(repo, { subject: 'first selfmod', conversationId: 'conv-A' })

    // a plain non-self-mod commit in between
    writeFileSync(join(repo, 'manual.txt'), 'm\n')
    await run(repo, ['add', '-A'])
    await run(repo, ['commit', '-m', 'manual edit'])

    writeFileSync(join(repo, 'b.txt'), 'b\n')
    await commitSelfMod(repo, { subject: 'second selfmod', conversationId: 'conv-B' })

    const mods = await recentSelfMods(repo)
    expect(mods.map((m) => m.subject)).toEqual(['second selfmod', 'first selfmod'])
    expect(mods.map((m) => m.conversationId)).toEqual(['conv-B', 'conv-A'])
    // baseline + manual are excluded
    expect(mods.every((m) => m.subject !== 'manual edit' && m.subject !== 'baseline')).toBe(true)
  })

  test('conversationId is null when the trailer is absent', async () => {
    // Hand-craft a commit that has the SelfMod marker but no conversation trailer.
    writeFileSync(join(repo, 'c.txt'), 'c\n')
    await run(repo, ['add', '-A'])
    await run(repo, ['commit', '-m', 'no-conv selfmod\n\nHearth-SelfMod: true'])

    const mods = await recentSelfMods(repo)
    expect(mods.length).toBe(1)
    expect(mods[0].subject).toBe('no-conv selfmod')
    expect(mods[0].conversationId).toBeNull()
  })

  test('respects the limit', async () => {
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(repo, `f${i}.txt`), `${i}\n`)
      await commitSelfMod(repo, { subject: `mod ${i}`, conversationId: `c${i}` })
    }
    const mods = await recentSelfMods(repo, 2)
    expect(mods.length).toBe(2)
    expect(mods.map((m) => m.subject)).toEqual(['mod 2', 'mod 1'])
  })
})

describe('revertCommit', () => {
  test('reverts a specific commit and returns the new HEAD', async () => {
    writeFileSync(join(repo, 'target.txt'), 'v1\n')
    const target = await commitSelfMod(repo, { subject: 'add target', conversationId: 'c' })

    const before = await head(repo)
    const reverted = await revertCommit(repo, target)

    expect(reverted).toBe(await head(repo))
    expect(reverted).not.toBe(before)
    // target.txt should be gone again.
    expect(await listDirty(repo)).toEqual([])
    expect(await diffPaths(repo, reverted)).toEqual(['target.txt'])
  })

  test('leaves later unrelated commits untouched', async () => {
    writeFileSync(join(repo, 'old.txt'), 'old\n')
    const target = await commitSelfMod(repo, { subject: 'add old', conversationId: 'c' })

    writeFileSync(join(repo, 'later.txt'), 'later\n')
    await commitSelfMod(repo, { subject: 'add later', conversationId: 'c2' })

    await revertCommit(repo, target)

    // later.txt must survive the revert of the earlier commit.
    expect(await listDirty(repo)).toEqual([])
    const subjects = await logSubjects(repo)
    expect(subjects).toContain('add later')
    expect(subjects.some((s) => s.startsWith('Revert "add old"'))).toBe(true)
  })
})

describe('diffPaths', () => {
  test('returns repo-relative paths a commit changed', async () => {
    writeFileSync(join(repo, 'x.txt'), 'x\n')
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'y.txt'), 'y\n')
    const hash = await commitSelfMod(repo, { subject: 'two files', conversationId: 'c' })

    expect((await diffPaths(repo, hash)).sort()).toEqual(['sub/y.txt', 'x.txt'])
  })

  test('works for a revert commit (drives reload tier later)', async () => {
    writeFileSync(join(repo, 'z.txt'), 'z\n')
    const target = await commitSelfMod(repo, { subject: 'add z', conversationId: 'c' })
    const reverted = await revertCommit(repo, target)

    // The revert commit touches the same path the original added.
    expect(await diffPaths(repo, reverted)).toEqual(['z.txt'])
    expect(await diffPaths(repo, target)).toEqual(['z.txt'])
  })

  test('returns paths for the baseline (root) commit too', async () => {
    const baseline = (await run(repo, ['rev-list', '--max-parents=0', 'HEAD'])).trim()
    expect(await diffPaths(repo, baseline)).toEqual(['baseline.txt'])
  })
})
