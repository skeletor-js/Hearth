import { test, expect, describe } from 'bun:test'
import { applyUpdate, EMPTY_TRANSCRIPT, type TranscriptState } from './transcript-reducer'
import type { PlanEntry, SessionUpdate } from '../../../electron/shared/protocol'

// Drive a sequence the way ChatView does: ids minted by the caller, state
// threaded through. A fixed clock keeps duration fields deterministic.
function run(updates: SessionUpdate[], opts: { state?: TranscriptState; turnStartAt?: number; replay?: boolean; onPlan?: (e: PlanEntry[]) => void } = {}) {
  let state = opts.state ?? EMPTY_TRANSCRIPT
  let nextId = 100
  let clock = 1_000_000
  for (const u of updates) {
    clock += 50
    state = applyUpdate(state, u, {
      freshTailId: nextId++,
      replay: opts.replay,
      turnStartAt: opts.turnStartAt,
      onPlan: opts.onPlan,
      now: () => clock,
    })
  }
  return state
}

const text = (t: string): SessionUpdate => ({ type: 'message', role: 'assistant', text: t })
const thought = (t: string): SessionUpdate => ({ type: 'thought', text: t })
const tool = (id: string, title: string, status: 'pending' | 'running' | 'done' | 'error' = 'running'): SessionUpdate => ({
  type: 'tool-call',
  id,
  title,
  status,
})
const plan = (...statuses: Array<PlanEntry['status']>): SessionUpdate => ({
  type: 'plan',
  entries: statuses.map((status, i) => ({ content: `step ${i}`, status, priority: 'medium' }) as PlanEntry),
})
const end: SessionUpdate = { type: 'end', stopReason: 'end_turn' }

const tailBlocks = (s: TranscriptState) => {
  const last = s.msgs[s.msgs.length - 1]
  if (last?.role !== 'hearth') throw new Error('no hearth tail')
  return last.blocks
}

describe('transcript reducer', () => {
  test('consecutive text deltas coalesce into one open text block', () => {
    const s = run([text('Hello'), text(' world'), text('!')])
    const blocks = tailBlocks(s)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ kind: 'text', text: 'Hello world!' })
  })

  test('thought runs stay distinct from text runs', () => {
    const s = run([thought('hmm'), thought(' okay'), text('Answer')])
    const blocks = tailBlocks(s)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].kind).toBe('trace')
    const trace = blocks[0] as Extract<(typeof blocks)[0], { kind: 'trace' }>
    expect(trace.steps).toHaveLength(1) // deltas coalesced into one think step
    expect(trace.steps[0].title).toBe('hmm okay')
    expect(blocks[1]).toEqual({ kind: 'text', text: 'Answer' })
  })

  test('a text block between thoughts closes the reasoning run (no cross-block coalescing)', () => {
    const s = run([thought('a'), text('mid'), thought('b')])
    const blocks = tailBlocks(s)
    // trace(a) + text(mid) + the second thought re-uses... a NEW trace block is
    // appended because the text block now sits at the tail.
    expect(blocks.map((b) => b.kind)).toEqual(['trace', 'text', 'trace'])
    const t2 = blocks[2] as Extract<(typeof blocks)[2], { kind: 'trace' }>
    expect(t2.steps[0].title).toBe('b')
  })

  test('a tool-call update attaches to its existing step by toolId', () => {
    const s = run([tool('t1', 'Read file', 'running'), tool('t1', 'Read file', 'done'), tool('t2', 'Run tests', 'running')])
    const blocks = tailBlocks(s)
    expect(blocks).toHaveLength(1)
    const trace = blocks[0] as Extract<(typeof blocks)[0], { kind: 'trace' }>
    expect(trace.steps).toHaveLength(2)
    expect(trace.steps[0]).toMatchObject({ toolId: 't1', status: 'done' })
    expect(trace.steps[1]).toMatchObject({ toolId: 't2', status: 'running' })
  })

  test('duplicate plan updates replace the planref, never append a second', () => {
    const seen: PlanEntry[][] = []
    const s = run([plan('pending', 'pending'), plan('completed', 'pending'), plan('completed', 'completed')], {
      onPlan: (e) => seen.push(e),
    })
    const blocks = tailBlocks(s)
    const refs = blocks.filter((b) => b.kind === 'planref')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toEqual({ kind: 'planref', done: 2, total: 2 })
    expect(seen).toHaveLength(3) // every update still reaches the plan sink
  })

  test('end synthesizes the edits result once and stamps the turn duration', () => {
    const s = run(
      [tool('t1', 'Edit ChatView.tsx'), { type: 'diff', path: 'src/app/chat/ChatView.tsx', oldText: 'a', newText: 'b' }, end],
      { turnStartAt: 999_000 },
    )
    const blocks = tailBlocks(s)
    const trace = blocks[0] as Extract<(typeof blocks)[0], { kind: 'trace' }>
    expect(trace.edits).toBe(1)
    expect(trace.result).toEqual({ text: 'Applied changes to 1 file', hasDiff: true })
    expect(trace.turnMs).toBeGreaterThan(0)
  })

  test('a second end does not double-synthesize the result', () => {
    const s1 = run([tool('t1', 'Edit x'), { type: 'diff', path: 'x', oldText: 'a', newText: 'b' }, end])
    const s2 = run([end], { state: s1 })
    const trace = tailBlocks(s2)[0] as Extract<ReturnType<typeof tailBlocks>[0], { kind: 'trace' }>
    expect(trace.result).toEqual({ text: 'Applied changes to 1 file', hasDiff: true })
  })

  test('interleaved thought/text/trace produce stable ordered blocks', () => {
    const s = run([thought('plan it'), tool('t1', 'Read file', 'done'), text('Here is'), text(' the answer'), end])
    const blocks = tailBlocks(s)
    expect(blocks.map((b) => b.kind)).toEqual(['trace', 'text'])
    const trace = blocks[0] as Extract<(typeof blocks)[0], { kind: 'trace' }>
    expect(trace.steps).toHaveLength(2)
    expect(trace.steps[0].kind).toBe('think')
    expect(trace.steps[1].toolId).toBe('t1')
    expect((blocks[1] as { text: string }).text).toBe('Here is the answer')
  })

  test('a diff attaches to the most recent non-think step and bumps edits', () => {
    const s = run([tool('t1', 'Edit files.ts'), { type: 'diff', path: 'electron/main/fs/files.ts', oldText: 'a', newText: 'b\nc' }])
    const trace = tailBlocks(s)[0] as Extract<ReturnType<typeof tailBlocks>[0], { kind: 'trace' }>
    expect(trace.edits).toBe(1)
    expect(trace.steps).toHaveLength(1)
    expect(trace.steps[0].kind).toBe('edit')
    expect(trace.steps[0].diff?.add).toBe(2)
  })

  test('tool-search plumbing is filtered out of the transcript', () => {
    const s = run([tool('t1', 'Tool Search')])
    expect(tailBlocks(s)).toHaveLength(0)
  })

  test('an update with no hearth tail creates one (replay after two user entries)', () => {
    const base: TranscriptState = {
      msgs: [{ id: 1, role: 'user', text: 'first' }],
      openText: false,
      openThought: false,
    }
    const s = run([text('reply')], { state: base })
    expect(s.msgs).toHaveLength(2)
    expect(s.msgs[1].role).toBe('hearth')
  })

  test('replay keeps persisted durations instead of stamping wall-clock', () => {
    const s = run([thought('persisted'), end], { replay: true })
    const trace = tailBlocks(s)[0] as Extract<ReturnType<typeof tailBlocks>[0], { kind: 'trace' }>
    expect(trace.steps[0].startedAt).toBeUndefined()
    expect(trace.turnMs).toBeUndefined()
  })

  test('non-chat updates (commands/mode/config/usage/info) leave the transcript untouched', () => {
    const s0 = run([text('hi')])
    const s1 = run(
      [
        { type: 'commands', commands: [] },
        { type: 'usage', usage: { totalTokens: 1 } as never },
      ],
      { state: s0 },
    )
    expect(s1.msgs).toEqual(s0.msgs)
  })
})
