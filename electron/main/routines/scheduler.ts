// The routine timer. Periodically finds due routines, advances their schedule,
// and hands each to `onDue` — which in practice emits an event to the renderer,
// the only thing that drives the agent. Main never runs an agent turn itself, so
// this stays thin and can't collide with an interactive session or brick boot.
//
// markRan runs BEFORE onDue: a routine's schedule advances whether or not the
// renderer is ready, so a closed/busy app drops a fire rather than storming it.

import type { Routine } from '../../shared/protocol.js'
import { dueRoutines } from './schedule.js'
import type { RoutineStore } from './store.js'

export class RoutineScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(
    private readonly store: RoutineStore,
    private readonly onDue: (r: Routine) => void,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    const due = dueRoutines(await this.store.list(), this.now())
    for (const r of due) {
      await this.store.markRan(r.id, this.now())
      try {
        this.onDue(r)
      } catch {
        // Renderer not ready — the fire is dropped, not retried, by design.
      }
    }
  }

  /** Fire a routine immediately (manual "Run now"), advancing its schedule. */
  async runNow(id: string): Promise<void> {
    const r = (await this.store.list()).find((x) => x.id === id)
    if (!r) return
    await this.store.markRan(id, this.now())
    this.onDue(r)
  }
}
