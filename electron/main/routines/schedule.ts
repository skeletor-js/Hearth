// Pure scheduling math for routines — no I/O, no Electron, fully unit-tested.

import type { Routine, RoutineSchedule } from '../../shared/protocol.js'

const DAY_MS = 24 * 60 * 60_000

/** Throw on a malformed schedule before it's ever persisted or scheduled. */
export function validateSchedule(s: RoutineSchedule): RoutineSchedule {
  if (s.type === 'interval') {
    if (!Number.isFinite(s.everyMinutes) || s.everyMinutes < 1) {
      throw new Error('Interval must be at least 1 minute.')
    }
    return s
  }
  if (s.type === 'daily') {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.time)
    if (!m) throw new Error('Time must be HH:MM (24-hour).')
    return s
  }
  throw new Error('Unknown schedule type.')
}

/** The next fire time strictly after `after` (ms epoch). For 'daily' this is the
 * next local HH:MM; for 'interval' it's `after + everyMinutes`. */
export function computeNextRun(schedule: RoutineSchedule, after: number): number {
  if (schedule.type === 'interval') {
    return after + Math.max(1, schedule.everyMinutes) * 60_000
  }
  const [h, m] = schedule.time.split(':').map(Number)
  const d = new Date(after)
  d.setHours(h, m, 0, 0)
  let t = d.getTime()
  if (t <= after) t += DAY_MS
  return t
}

/** Enabled routines whose next run has arrived. */
export function dueRoutines(routines: readonly Routine[], now: number): Routine[] {
  return routines.filter((r) => r.enabled && r.nextRunAt != null && r.nextRunAt <= now)
}
