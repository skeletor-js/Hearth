import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoutineStore } from './store'
import { RoutineScheduler } from './scheduler'
import type { Routine } from '../../shared/protocol'

let dir: string
let clock: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-sched-'))
  clock = 1_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const mk = async (store: RoutineStore) =>
  store.create({ title: 't', prompt: 'p', schedule: { type: 'interval', everyMinutes: 1 }, workspaceId: 'w', cwd: '/w' })

describe('RoutineScheduler.tick', () => {
  test('fires due routines and advances them so they do not double-fire', async () => {
    const store = new RoutineStore(dir, () => clock)
    const r = await mk(store)
    const fired: Routine[] = []
    const sched = new RoutineScheduler(store, (x) => fired.push(x), () => clock)

    // Not due yet (nextRunAt is clock + 60s).
    await sched.tick()
    expect(fired).toHaveLength(0)

    // Advance past the due time → fires once.
    clock += 61_000
    await sched.tick()
    expect(fired.map((x) => x.id)).toEqual([r.id])

    // Same tick window again → already advanced, no refire.
    await sched.tick()
    expect(fired).toHaveLength(1)
  })

  test('runNow fires immediately and advances the schedule', async () => {
    const store = new RoutineStore(dir, () => clock)
    const r = await mk(store)
    const fired: Routine[] = []
    const sched = new RoutineScheduler(store, (x) => fired.push(x), () => clock)

    await sched.runNow(r.id)
    expect(fired.map((x) => x.id)).toEqual([r.id])
    const after = (await store.list())[0]
    expect(after.lastRunAt).toBe(clock)
  })
})
