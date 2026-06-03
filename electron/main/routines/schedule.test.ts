import { test, expect, describe } from 'bun:test'
import { computeNextRun, dueRoutines, validateSchedule } from './schedule'
import type { Routine } from '../../shared/protocol'

describe('validateSchedule', () => {
  test('accepts a valid interval and daily', () => {
    expect(validateSchedule({ type: 'interval', everyMinutes: 5 })).toBeDefined()
    expect(validateSchedule({ type: 'daily', time: '08:30' })).toBeDefined()
    expect(validateSchedule({ type: 'daily', time: '9:05' })).toBeDefined()
  })
  test('rejects bad values', () => {
    expect(() => validateSchedule({ type: 'interval', everyMinutes: 0 })).toThrow()
    expect(() => validateSchedule({ type: 'daily', time: '24:00' })).toThrow()
    expect(() => validateSchedule({ type: 'daily', time: '8h' })).toThrow()
  })
})

describe('computeNextRun', () => {
  test('interval adds the minute span', () => {
    expect(computeNextRun({ type: 'interval', everyMinutes: 10 }, 1_000_000)).toBe(1_000_000 + 600_000)
  })
  test('daily picks the next local HH:MM strictly after', () => {
    const base = new Date(2026, 5, 2, 9, 0, 0, 0).getTime() // Jun 2 2026, 09:00 local
    const at8 = new Date(2026, 5, 3, 8, 0, 0, 0).getTime() // next day 08:00 (already past today)
    expect(computeNextRun({ type: 'daily', time: '08:00' }, base)).toBe(at8)
    const at10 = new Date(2026, 5, 2, 10, 30, 0, 0).getTime() // later same day
    expect(computeNextRun({ type: 'daily', time: '10:30' }, base)).toBe(at10)
  })
  test('daily at the exact current minute rolls to tomorrow (strictly after)', () => {
    const base = new Date(2026, 5, 2, 8, 0, 0, 0).getTime()
    const tomorrow8 = new Date(2026, 5, 3, 8, 0, 0, 0).getTime()
    expect(computeNextRun({ type: 'daily', time: '08:00' }, base)).toBe(tomorrow8)
  })
})

describe('dueRoutines', () => {
  const r = (over: Partial<Routine>): Routine => ({
    id: 'r', title: 't', prompt: 'p', schedule: { type: 'interval', everyMinutes: 5 },
    workspaceId: 'w', cwd: '/w', enabled: true, createdAt: 0, lastRunAt: null, nextRunAt: 100, ...over,
  })
  test('returns enabled routines whose nextRunAt has passed', () => {
    const list = [r({ id: 'a', nextRunAt: 50 }), r({ id: 'b', nextRunAt: 200 }), r({ id: 'c', nextRunAt: 100 })]
    expect(dueRoutines(list, 100).map((x) => x.id)).toEqual(['a', 'c'])
  })
  test('skips disabled and never-scheduled routines', () => {
    const list = [r({ id: 'a', enabled: false, nextRunAt: 10 }), r({ id: 'b', nextRunAt: null })]
    expect(dueRoutines(list, 100)).toEqual([])
  })
})
