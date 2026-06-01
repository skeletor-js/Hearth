import { test, expect, describe } from 'bun:test'
import path from 'node:path'
import { OverlayState } from './self-mod-overlay'

const REPO = '/Users/x/Hearth'
const id = (rel: string) => path.join(REPO, rel)

describe('OverlayState', () => {
  test('pinned module id serves its baseline; unpinned serves disk (null)', () => {
    const s = new OverlayState(REPO)
    s.pin('src/app/Chat.tsx', 'OLD SOURCE')
    expect(s.baselineForId(id('src/app/Chat.tsx'))).toBe('OLD SOURCE')
    expect(s.isPinnedId(id('src/app/Chat.tsx'))).toBe(true)
    expect(s.baselineForId(id('src/app/Other.tsx'))).toBeNull()
  })

  test('id with a query string still matches the pin', () => {
    const s = new OverlayState(REPO)
    s.pin('src/app/Chat.tsx', 'OLD')
    expect(s.baselineForId(id('src/app/Chat.tsx') + '?t=123')).toBe('OLD')
  })

  test('apply drops pins and returns module ids to reload', () => {
    const s = new OverlayState(REPO)
    s.pin('src/a.tsx', 'a0')
    s.pin('src/b.tsx', 'b0')
    expect(s.hasPins()).toBe(true)
    const ids = s.apply(['src/a.tsx', 'src/b.tsx'])
    expect(ids.sort()).toEqual([id('src/a.tsx'), id('src/b.tsx')].sort())
    expect(s.hasPins()).toBe(false)
    expect(s.isPinnedId(id('src/a.tsx'))).toBe(false)
  })

  test('release drops pins without returning reload ids', () => {
    const s = new OverlayState(REPO)
    s.pin('src/a.tsx', 'a0')
    s.release(['src/a.tsx'])
    expect(s.hasPins()).toBe(false)
  })

  test('paths outside the repo do not match', () => {
    const s = new OverlayState(REPO)
    expect(s.toRepoRel('/Users/x/other/file.ts')).toBeNull()
    expect(s.baselineForId('/Users/x/other/file.ts')).toBeNull()
  })
})
