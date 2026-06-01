import { test, expect, describe } from 'bun:test'
import path from 'node:path'
import { WriteBroker, gitMergeFile, type BrokerDeps, type MergeResult } from './write-broker'

const REPO = '/Users/x/Hearth'
const abs = (rel: string) => path.join(REPO, rel)

// A fake disk + recording deps for the pure core.
function fakeDeps(initial: Record<string, string> = {}): BrokerDeps & {
  disk: Map<string, string>
  writes: string[]
  baselines: Array<string | null>
  mergeImpl: (b: string, o: string, t: string) => MergeResult
} {
  const disk = new Map(Object.entries(initial).map(([k, v]) => [abs(k), v]))
  const writes: string[] = []
  const baselines: Array<string | null> = []
  const deps = {
    repoRoot: REPO,
    disk,
    writes,
    baselines,
    mergeImpl: (_b: string, _o: string, _t: string): MergeResult => ({ clean: true, text: 'MERGED' }),
    read: (p: string) => (disk.has(p) ? disk.get(p)! : null),
    write: (p: string, c: string) => {
      disk.set(p, c)
      writes.push(p)
    },
    merge: (b: string, o: string, t: string) => deps.mergeImpl(b, o, t),
    onWrite: (_p: string, baseline: string | null) => baselines.push(baseline),
  }
  return deps
}

describe('WriteBroker — scope enforcement', () => {
  test('blocked paths are rejected', () => {
    const d = fakeDeps()
    const b = new WriteBroker(d)
    expect(b.writeFile(abs('.env'), 'x').status).toBe('blocked')
    expect(b.writeFile('/etc/hosts', 'x').status).toBe('blocked')
    expect(d.writes).toEqual([])
  })

  test('protected island needs approval', () => {
    const denied = new WriteBroker(fakeDeps())
    expect(denied.writeFile(abs('electron/main/self-mod/git.ts'), 'x').status).toBe('protected')

    const d = fakeDeps()
    const approved = new WriteBroker({ ...d, approveProtected: () => true })
    expect(approved.writeFile(abs('electron/main/self-mod/git.ts'), 'x').status).toBe('ok')
  })

  test('canvas writes go through', () => {
    const d = fakeDeps()
    const b = new WriteBroker(d)
    expect(b.writeFile(abs('src/app/Chat.tsx'), 'hello').status).toBe('ok')
    expect(d.disk.get(abs('src/app/Chat.tsx'))).toBe('hello')
  })
})

describe('WriteBroker — 3-way merge / lost-update prevention', () => {
  test('write whose base is current → plain write (no merge)', () => {
    const d = fakeDeps({ 'src/a.ts': 'v0' })
    const b = new WriteBroker(d)
    b.readFile(abs('src/a.ts')) // base = v0
    expect(b.writeFile(abs('src/a.ts'), 'v1').status).toBe('ok')
  })

  test('disk moved under us + clean merge → merged, not clobbered', () => {
    const d = fakeDeps({ 'src/a.ts': 'v0' })
    const b = new WriteBroker(d)
    b.readFile(abs('src/a.ts')) // this writer based on v0
    d.disk.set(abs('src/a.ts'), 'v1-from-other-subagent') // someone else wrote
    const r = b.writeFile(abs('src/a.ts'), 'v0-plus-my-change')
    expect(r.status).toBe('merged')
    expect(d.disk.get(abs('src/a.ts'))).toBe('MERGED') // merge result, not a clobber
  })

  test('disk moved + true conflict → rejected (no write)', () => {
    const d = fakeDeps({ 'src/a.ts': 'v0' })
    d.mergeImpl = () => ({ clean: false, text: '<<<<<<<' })
    const b = new WriteBroker(d)
    b.readFile(abs('src/a.ts'))
    d.disk.set(abs('src/a.ts'), 'v1')
    const r = b.writeFile(abs('src/a.ts'), 'v2')
    expect(r.status).toBe('conflict')
    expect(d.disk.get(abs('src/a.ts'))).toBe('v1') // untouched
  })

  test('records the pre-edit baseline for the run tracker', () => {
    const d = fakeDeps({ 'src/a.ts': 'v0' })
    const b = new WriteBroker(d)
    b.readFile(abs('src/a.ts'))
    b.writeFile(abs('src/a.ts'), 'v1')
    expect(d.baselines).toEqual(['v0'])
  })
})

describe('gitMergeFile (real git)', () => {
  test('disjoint regions merge clean', async () => {
    const base = 'line1\nline2\nline3\n'
    const ours = 'LINE1\nline2\nline3\n' // changed line1
    const theirs = 'line1\nline2\nLINE3\n' // changed line3
    const r = await gitMergeFile(base, ours, theirs)
    expect(r.clean).toBe(true)
    expect(r.text).toBe('LINE1\nline2\nLINE3\n')
  })

  test('overlapping edits conflict', async () => {
    const base = 'line1\n'
    const ours = 'OURS\n'
    const theirs = 'THEIRS\n'
    const r = await gitMergeFile(base, ours, theirs)
    expect(r.clean).toBe(false)
  })
})
