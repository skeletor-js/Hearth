import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoutineStore } from './store'

let dir: string
let clock: number
const store = () => new RoutineStore(dir, () => clock)

const input = {
  title: 'Morning brief',
  prompt: 'brief me',
  schedule: { type: 'interval', everyMinutes: 60 } as const,
  workspaceId: 'w',
  cwd: '/w',
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-routines-'))
  clock = 1_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('RoutineStore', () => {
  test('create sets nextRunAt from the schedule and persists', async () => {
    const s = store()
    const r = await s.create(input)
    expect(r.nextRunAt).toBe(1_000_000 + 3_600_000)
    expect(r.enabled).toBe(true)
    expect((await s.list()).map((x) => x.id)).toEqual([r.id])
  })

  test('create rejects an invalid schedule', async () => {
    await expect(store().create({ ...input, schedule: { type: 'daily', time: '99:99' } })).rejects.toThrow()
  })

  test('disabling clears nextRunAt; re-enabling recomputes it', async () => {
    const s = store()
    const r = await s.create(input)
    clock = 2_000_000
    const off = await s.setEnabled(r.id, false)
    expect(off?.nextRunAt).toBeNull()
    const on = await s.setEnabled(r.id, true)
    expect(on?.nextRunAt).toBe(2_000_000 + 3_600_000)
  })

  test('markRan stamps lastRunAt and advances nextRunAt past the run', async () => {
    const s = store()
    const r = await s.create(input)
    const ran = await s.markRan(r.id, 5_000_000)
    expect(ran?.lastRunAt).toBe(5_000_000)
    expect(ran?.nextRunAt).toBe(5_000_000 + 3_600_000)
  })

  test('update changes the schedule and recomputes nextRunAt', async () => {
    const s = store()
    const r = await s.create(input)
    clock = 3_000_000
    const up = await s.update(r.id, { schedule: { type: 'interval', everyMinutes: 30 } })
    expect(up?.nextRunAt).toBe(3_000_000 + 1_800_000)
  })

  test('remove drops it', async () => {
    const s = store()
    const r = await s.create(input)
    await s.remove(r.id)
    expect(await s.list()).toEqual([])
  })
})
