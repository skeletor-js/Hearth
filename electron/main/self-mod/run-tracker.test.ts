import { test, expect, describe } from 'bun:test'
import { RunTracker, MAIN_LABEL } from './run-tracker'

describe('RunTracker — attribution + grouping', () => {
  test('disjoint subagents → one group each', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordLane('r1', 'taskA', 'Left sidebar', 'running')
    t.recordLane('r1', 'taskB', 'Heading', 'running')
    t.recordWrite('r1', 'src/shell/Rail.tsx', { parentToolCallId: 'taskA' })
    t.recordWrite('r1', 'src/shell/Rail.css', { parentToolCallId: 'taskA' })
    t.recordWrite('r1', 'src/shell/Topbar.tsx', { parentToolCallId: 'taskB' })

    const res = t.endRun('r1')!
    expect(res.groups.length).toBe(2)
    const byLabel = Object.fromEntries(res.groups.map((g) => [g.subagentLabel, g.paths]))
    expect(byLabel['Left sidebar']).toEqual(['src/shell/Rail.css', 'src/shell/Rail.tsx'])
    expect(byLabel['Heading']).toEqual(['src/shell/Topbar.tsx'])
  })

  test('two subagents sharing a file → merged into one group (file-disjoint)', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordLane('r1', 'taskA', 'Heading', 'running')
    t.recordLane('r1', 'taskB', 'Right sidebar', 'running')
    // both touch __root.tsx
    t.recordWrite('r1', 'src/routes/__root.tsx', { parentToolCallId: 'taskA' })
    t.recordWrite('r1', 'src/routes/__root.tsx', { parentToolCallId: 'taskB' })
    t.recordWrite('r1', 'src/shell/store.ts', { parentToolCallId: 'taskB' })

    const res = t.endRun('r1')!
    // the shared file collapses taskA + taskB into a single group
    expect(res.groups.length).toBe(1)
    expect(res.groups[0].paths).toEqual(['src/routes/__root.tsx', 'src/shell/store.ts'])
    expect(res.groups[0].labels.sort()).toEqual(['taskA', 'taskB'])
  })

  test('orchestrator-only edits → single main group', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordWrite('r1', 'src/a.ts')
    t.recordWrite('r1', 'src/b.ts')
    const res = t.endRun('r1')!
    expect(res.groups.length).toBe(1)
    expect(res.groups[0].subagentLabel).toBe(MAIN_LABEL)
    expect(res.groups[0].paths).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('RunTracker — concurrency gate', () => {
  test('two running lanes → concurrent (atomic mode)', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordLane('r1', 'taskA', 'A', 'running')
    t.markSubagent('r1', 'taskA')
    expect(t.isConcurrent('r1')).toBe(false)
    t.recordLane('r1', 'taskB', 'B', 'running')
    t.markSubagent('r1', 'taskB')
    expect(t.isConcurrent('r1')).toBe(true)
    expect(t.concurrentWriterCount('r1')).toBe(2)
    // one finishes → back below threshold
    t.recordLane('r1', 'taskA', 'A', 'done')
    expect(t.isConcurrent('r1')).toBe(false)
  })

  test('a lone subagent is not concurrent', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordLane('r1', 'taskA', 'A', 'running')
    t.markSubagent('r1', 'taskA')
    expect(t.isConcurrent('r1')).toBe(false)
  })

  test('unmarked tool-calls (orchestrator Reads/Edits) never count as subagents', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    // Two plain top-level tool-calls, neither marked a subagent.
    t.recordLane('r1', 'read1', 'Read', 'running')
    t.recordLane('r1', 'edit1', 'Edit', 'running')
    expect(t.concurrentWriterCount('r1')).toBe(0)
    expect(t.isConcurrent('r1')).toBe(false)
    expect(t.activity('r1')!.lanes).toEqual([])
  })
})

describe('RunTracker — baseline + activity', () => {
  test('baseline captured + backfilled; new file is null', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordWrite('r1', 'src/a.ts', { baseline: 'OLD' })
    t.recordWrite('r1', 'src/new.ts') // new file, no baseline
    expect(t.baselineFor('r1', 'src/a.ts')).toBe('OLD')
    expect(t.baselineFor('r1', 'src/new.ts')).toBeNull()
    // backfill on a later write
    t.recordWrite('r1', 'src/new.ts', { baseline: '' })
    expect(t.baselineFor('r1', 'src/new.ts')).toBe('')
  })

  test('activity reports lanes + collisions', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    t.recordLane('r1', 'taskA', 'A', 'running')
    t.recordLane('r1', 'taskB', 'B', 'running')
    t.markSubagent('r1', 'taskA')
    t.markSubagent('r1', 'taskB')
    t.recordWrite('r1', 'src/shared.ts', { parentToolCallId: 'taskA' })
    t.recordWrite('r1', 'src/shared.ts', { parentToolCallId: 'taskB' })
    t.recordWrite('r1', 'src/a.ts', { parentToolCallId: 'taskA' })
    const a = t.activity('r1')!
    expect(a.collisions).toEqual(['src/shared.ts'])
    const laneA = a.lanes.find((l) => l.toolCallId === 'taskA')!
    expect(laneA.paths.sort()).toEqual(['src/a.ts', 'src/shared.ts'])
  })

  test('runForSession routing', () => {
    const t = new RunTracker()
    t.beginRun('r1', 's1')
    expect(t.runForSession('s1')).toBe('r1')
    t.endRun('r1')
    expect(t.runForSession('s1')).toBeNull()
  })
})
