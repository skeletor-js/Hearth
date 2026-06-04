import { describe, expect, test } from 'bun:test'
import { changedRange, usePresence, getPresence, FRESH_PRESENCE } from './presence-store'
import { aggregateStatus } from '@/shell/Presence'
import type { SessionUpdate } from '../../electron/shared/protocol'

describe('changedRange', () => {
  test('new file spans all its lines', () => {
    expect(changedRange(null, 'a\nb\nc')).toEqual([1, 3])
  })
  test('empty new file is no range', () => {
    expect(changedRange(null, '')).toEqual([1, 1])
  })
  test('single changed line in the middle', () => {
    expect(changedRange('a\nb\nc', 'a\nX\nc')).toEqual([2, 2])
  })
  test('inserted lines report the new-text range', () => {
    expect(changedRange('a\nb', 'a\nX\nY\nb')).toEqual([2, 3])
  })
  test('pure deletion anchors a single-line marker', () => {
    expect(changedRange('a\nb\nc', 'a\nc')).toEqual([2, 2])
  })
  test('appended line', () => {
    expect(changedRange('a\nb', 'a\nb\nc')).toEqual([3, 3])
  })
})

describe('aggregateStatus', () => {
  test('idle when empty', () => {
    expect(aggregateStatus({})).toBe('idle')
  })
  test('waiting wins over working', () => {
    expect(aggregateStatus({ a: { status: 'working' }, b: { status: 'waiting' } })).toBe('waiting')
  })
  test('working wins over thinking', () => {
    expect(aggregateStatus({ a: { status: 'thinking' }, b: { status: 'working' } })).toBe('working')
  })
})

const reset = () => usePresence.setState({ byId: {} })

describe('presence reducer', () => {
  test('markSending starts a fresh working run', () => {
    reset()
    usePresence.getState().markSending('s1')
    const p = getPresence('s1')
    expect(p.status).toBe('thinking')
    expect(p.edits).toBe(0)
    expect(p.startedAt).not.toBeNull()
  })

  test('tool-call running → working with a label', () => {
    reset()
    const u: SessionUpdate = { type: 'tool-call', id: 't1', title: 'Edit FilesTab.tsx', status: 'running' }
    usePresence.getState().applyUpdate('s1', u, true)
    expect(getPresence('s1').status).toBe('working')
    expect(getPresence('s1').label).toBe('Edit FilesTab.tsx')
  })

  test('diff accrues recentFiles with a changed range', () => {
    reset()
    const u: SessionUpdate = { type: 'diff', path: '/repo/src/x.ts', oldText: 'a\nb', newText: 'a\nX' }
    usePresence.getState().applyUpdate('s1', u, true)
    const p = getPresence('s1')
    expect(p.edits).toBe(1)
    expect(p.recentFiles[0].path).toBe('/repo/src/x.ts')
    expect(p.recentFiles[0].range).toEqual([2, 2])
  })

  test('end while inactive with edits marks unread', () => {
    reset()
    usePresence.getState().markSending('s1')
    usePresence.getState().applyUpdate('s1', { type: 'diff', path: 'x', oldText: null, newText: 'q' }, false)
    usePresence.getState().applyUpdate('s1', { type: 'end', stopReason: 'done' }, false)
    const p = getPresence('s1')
    expect(p.status).toBe('done')
    expect(p.unread).toBe(true)
  })

  test('end while active does not mark unread', () => {
    reset()
    usePresence.getState().markSending('s1')
    usePresence.getState().applyUpdate('s1', { type: 'diff', path: 'x', oldText: null, newText: 'q' }, true)
    usePresence.getState().applyUpdate('s1', { type: 'end', stopReason: 'done' }, true)
    expect(getPresence('s1').unread).toBe(false)
  })

  test('a pending permission sets waiting and is not overridden by streamed thought', () => {
    reset()
    usePresence.getState().setPermission('s1', { id: 'p1', title: 'run ls', options: [] })
    expect(getPresence('s1').status).toBe('waiting')
    usePresence.getState().applyUpdate('s1', { type: 'thought', text: 'hmm' }, true)
    expect(getPresence('s1').status).toBe('waiting')
  })

  test('clearing the permission leaves waiting', () => {
    reset()
    usePresence.getState().setPermission('s1', { id: 'p1', title: 'x', options: [] })
    usePresence.getState().setPermission('s1', null)
    expect(getPresence('s1').pendingPermission).toBeNull()
  })

  test('getPresence returns a fresh record for unknown sessions', () => {
    reset()
    expect(getPresence('nope')).toEqual(FRESH_PRESENCE)
  })
})
