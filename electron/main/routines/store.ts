// Routine persistence: a single JSON file of routine definitions under userData.
// Storage only — no Electron, no agent — so it unit-tests against a temp dir. The
// schedule math lives in schedule.ts; this module just holds the records and keeps
// nextRunAt in sync on create / enable / fire.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreateRoutineInput, Routine } from '../../shared/protocol.js'
import { computeNextRun, validateSchedule } from './schedule.js'

export class RoutineStore {
  private counter = 0
  constructor(
    private readonly baseDir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private indexPath(): string {
    return join(this.baseDir, 'routines.json')
  }

  private async read(): Promise<Routine[]> {
    try {
      const raw = await readFile(this.indexPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async write(list: Routine[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.indexPath(), JSON.stringify(list, null, 2))
  }

  async list(): Promise<Routine[]> {
    return (await this.read()).sort((a, b) => b.createdAt - a.createdAt)
  }

  async create(input: CreateRoutineInput): Promise<Routine> {
    validateSchedule(input.schedule)
    const t = this.now()
    const routine: Routine = {
      id: `rt_${t.toString(36)}_${this.counter++}`,
      title: input.title.trim() || 'Routine',
      prompt: input.prompt,
      schedule: input.schedule,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      enabled: true,
      createdAt: t,
      lastRunAt: null,
      nextRunAt: computeNextRun(input.schedule, t),
    }
    await this.write([routine, ...(await this.read())])
    return routine
  }

  private async patch(id: string, fn: (r: Routine) => Routine): Promise<Routine | null> {
    const list = await this.read()
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) return null
    const next = fn(list[i])
    list[i] = next
    await this.write(list)
    return next
  }

  /** Replace schedule/title/prompt; recompute nextRunAt from the new schedule. */
  async update(id: string, patch: Partial<CreateRoutineInput>): Promise<Routine | null> {
    if (patch.schedule) validateSchedule(patch.schedule)
    return this.patch(id, (r) => {
      const schedule = patch.schedule ?? r.schedule
      return {
        ...r,
        title: patch.title?.trim() || r.title,
        prompt: patch.prompt ?? r.prompt,
        schedule,
        nextRunAt: r.enabled ? computeNextRun(schedule, this.now()) : null,
      }
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<Routine | null> {
    return this.patch(id, (r) => ({
      ...r,
      enabled,
      nextRunAt: enabled ? computeNextRun(r.schedule, this.now()) : null,
    }))
  }

  /** Record a fire: stamp lastRunAt and advance nextRunAt past it. */
  async markRan(id: string, ranAt: number): Promise<Routine | null> {
    return this.patch(id, (r) => ({
      ...r,
      lastRunAt: ranAt,
      nextRunAt: r.enabled ? computeNextRun(r.schedule, ranAt) : null,
    }))
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((r) => r.id !== id))
  }
}
