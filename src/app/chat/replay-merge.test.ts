import { test, expect, describe } from 'bun:test'
import { pendingAfterSnapshot } from './replay-merge'
import type { SessionUpdate } from '../../../electron/shared/protocol'

const t = (text: string): SessionUpdate => ({ type: 'message', role: 'assistant', text })
const entry = (u: SessionUpdate) => ({ kind: 'update', update: u })

describe('pendingAfterSnapshot', () => {
  test('nothing buffered → nothing to flush', () => {
    expect(pendingAfterSnapshot([], [entry(t('a'))])).toEqual([])
  })

  test('no overlap: every buffered update flushes in order', () => {
    const buf = [t('x'), t('y')]
    expect(pendingAfterSnapshot(buf, [entry(t('a')), entry(t('b'))])).toEqual(buf)
  })

  test('full overlap: snapshot already persisted everything buffered', () => {
    const buf = [t('x'), t('y')]
    expect(pendingAfterSnapshot(buf, [entry(t('a')), entry(t('x')), entry(t('y'))])).toEqual([])
  })

  test('partial overlap: only the unpersisted suffix flushes', () => {
    const buf = [t('x'), t('y'), t('z')]
    expect(pendingAfterSnapshot(buf, [entry(t('a')), entry(t('x'))])).toEqual([t('y'), t('z')])
  })

  test('identical consecutive deltas are matched positionally, not by content', () => {
    // The stream "…", "…" twice: snapshot holds one of them; exactly one flushes.
    const buf = [t('…'), t('…')]
    expect(pendingAfterSnapshot(buf, [entry(t('…'))])).toEqual([t('…')])
  })

  test('user entries in the snapshot are ignored for matching', () => {
    const buf = [t('x')]
    const snapshot = [{ kind: 'user' }, entry(t('x')), { kind: 'user' }]
    // tail of UPDATE entries is [x] — matches the buffer front.
    expect(pendingAfterSnapshot(buf, snapshot)).toEqual([])
  })
})
