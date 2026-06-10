// The transcript reducer (U12): folds one streamed SessionUpdate into the
// chat's message list. Extracted verbatim from ChatView's setMsgs updater —
// the most intricate renderer state machine — so it is pure, dependency-free,
// and unit-tested. Ids are minted by the CALLER (React may invoke an updater
// twice, and an updater must be pure — see ChatView); the open-run flags that
// were refs in ChatView ride along in the state so coalescing survives
// extraction without hidden module state.
import type { PlanEntry, SessionUpdate } from '../../../electron/shared/protocol'
import type { PromptImage } from '../../../electron/shared/protocol'
import { inferKind, type DiffRow, type TraceResult, type TraceStep } from './trace'

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'trace'; steps: TraceStep[]; result?: TraceResult; edits: number; turnMs?: number }
  | { kind: 'planref'; done: number; total: number }
export type Msg =
  | { id: number; role: 'user'; text: string; images?: PromptImage[] }
  | { id: number; role: 'hearth'; blocks: Block[] }
  | { id: number; role: 'system'; text: string }

export interface TranscriptState {
  msgs: Msg[]
  /** The tail hearth block is a coalescing text block (streaming deltas append). */
  openText: boolean
  /** Streaming a single reasoning block (coalesce thought deltas into one step). */
  openThought: boolean
}

export const EMPTY_TRANSCRIPT: TranscriptState = { msgs: [], openText: false, openThought: false }

export interface ApplyContext {
  /** Pre-minted id, consumed only when a fresh hearth tail must be created. */
  freshTailId: number
  /** Replaying persisted history: no wall-clock stamps, keep persisted durations. */
  replay?: boolean
  /** Wall-clock turn start (ms) for the end-of-turn "Worked · Ns" badge; 0 = unknown. */
  turnStartAt?: number
  /** Plan entries surface in the session store, not the transcript — the caller
   * supplies the sink so this module stays dependency-free. */
  onPlan?: (entries: PlanEntry[]) => void
  /** Clock injection for tests. */
  now?: () => number
}

const MAX_DIFF_ROWS = 60

function basename(p: string): string {
  return p.split('/').pop() || p
}

export function diffRows(oldText: string | null, newText: string): { add: number; del: number; rows: DiffRow[] } {
  const dels = oldText ? oldText.split('\n') : []
  const adds = newText.split('\n')
  const rows: DiffRow[] = []
  let ln = 1
  for (const code of dels) {
    if (rows.length >= MAX_DIFF_ROWS) break
    rows.push({ t: 'del', code, ln: ln++ })
  }
  ln = 1
  for (const code of adds) {
    if (rows.length >= MAX_DIFF_ROWS) break
    rows.push({ t: 'add', code, ln: ln++ })
  }
  const dropped = dels.length + adds.length - rows.length
  if (dropped > 0) rows.push({ t: 'ctx', code: `… ${dropped} more lines` })
  return { add: newText === '' ? 0 : adds.length, del: oldText ? dels.length : 0, rows }
}

/** Ensure a hearth message sits at the tail to receive stream blocks. The fresh
 * id is used only if a new tail is needed; reuse leaves a harmless id gap. */
function withHearthTail(prev: Msg[], freshId: number): [Msg[], Extract<Msg, { role: 'hearth' }>] {
  const last = prev[prev.length - 1]
  if (last?.role === 'hearth') return [prev, last]
  const fresh: Msg = { id: freshId, role: 'hearth', blocks: [] }
  return [[...prev, fresh], fresh as Extract<Msg, { role: 'hearth' }>]
}

/** Pure: fold one streamed update into the transcript. Returns the same state
 * object semantics ChatView's inline updater had — including every quirk. */
export function applyUpdate(state: TranscriptState, u: SessionUpdate, ctx: ApplyContext): TranscriptState {
  const now = ctx.now ?? Date.now
  const replay = ctx.replay ?? false
  const [prev, tail] = withHearthTail(state.msgs, ctx.freshTailId)
  const blocks = tail.blocks
  const lastBlock = blocks[blocks.length - 1]
  // Any non-thought update ends the current reasoning run.
  let openText = state.openText
  let openThought = u.type === 'thought' ? state.openThought : false

  const done = (msgs: Msg[]): TranscriptState => ({ msgs, openText, openThought })
  const replaceTail = (newBlocks: Block[]): Msg[] => {
    const next = [...prev]
    next[next.length - 1] = { ...tail, blocks: newBlocks }
    return next
  }
  const ensureTrace = (): { steps: TraceStep[]; rebuild: (steps: TraceStep[], edits?: number) => Msg[] } => {
    if (lastBlock?.kind === 'trace') {
      const tb = lastBlock
      return {
        steps: tb.steps,
        rebuild: (steps, edits = tb.edits) => replaceTail([...blocks.slice(0, -1), { ...tb, steps, edits }]),
      }
    }
    return {
      steps: [],
      rebuild: (steps, edits = 0) => replaceTail([...blocks, { kind: 'trace', steps, edits }]),
    }
  }

  switch (u.type) {
    case 'message': {
      if (openText && lastBlock?.kind === 'text') {
        return done(replaceTail([...blocks.slice(0, -1), { kind: 'text', text: lastBlock.text + u.text }]))
      }
      openText = true
      return done(replaceTail([...blocks, { kind: 'text', text: u.text }]))
    }
    case 'plan': {
      openText = false
      ctx.onPlan?.(u.entries)
      const completed = u.entries.filter((e) => e.status === 'completed').length
      const ref: Block = { kind: 'planref', done: completed, total: u.entries.length }
      const pi = blocks.findIndex((b) => b.kind === 'planref')
      if (pi >= 0) {
        const next = [...blocks]
        next[pi] = ref
        return done(replaceTail(next))
      }
      return done(replaceTail([...blocks, ref]))
    }
    case 'thought': {
      openText = false
      const { steps, rebuild } = ensureTrace()
      const last = steps[steps.length - 1]
      // Coalesce streaming deltas of one reasoning block into a single step
      // instead of spawning a node per chunk.
      if (openThought && last?.kind === 'think') {
        const next = [...steps]
        next[next.length - 1] = {
          ...last,
          title: last.title + u.text,
          thinkMs: last.startedAt ? now() - last.startedAt : last.thinkMs,
        }
        return done(rebuild(next))
      }
      openThought = true
      return done(rebuild([...steps, { kind: 'think', status: 'done', title: u.text, startedAt: replay ? undefined : now() }]))
    }
    case 'tool-call': {
      openText = false
      // The agent's internal tool-discovery is plumbing, not a user-facing step.
      if (/^tool\s*search$/i.test(u.title.trim())) return done(prev)
      const { steps, rebuild } = ensureTrace()
      const i = steps.findIndex((s) => s.toolId === u.id)
      if (i >= 0) {
        const next = [...steps]
        next[i] = { ...next[i], title: u.title, status: u.status, kind: next[i].kind ?? inferKind(u.title) }
        return done(rebuild(next))
      }
      return done(rebuild([...steps, { toolId: u.id, kind: inferKind(u.title), status: u.status, title: u.title }]))
    }
    case 'diff': {
      openText = false
      const curEdits = lastBlock?.kind === 'trace' ? lastBlock.edits : 0
      const { steps, rebuild } = ensureTrace()
      const d = diffRows(u.oldText, u.newText)
      const diff = { path: u.path, add: d.add, del: d.del, rows: d.rows }
      // Attach to the most recent step (the tool-call that just produced it).
      if (steps.length && steps[steps.length - 1].kind !== 'think') {
        const next = [...steps]
        const s = next[next.length - 1]
        next[next.length - 1] = { ...s, kind: 'edit', diff }
        return done(rebuild(next, curEdits + 1))
      }
      return done(rebuild([...steps, { kind: 'edit', status: 'done', title: `Edit ${basename(u.path)}`, diff }], curEdits + 1))
    }
    case 'commands':
      // The agent's advertised slash commands / skills are captured for
      // Settings, never rendered into the chat transcript.
      return done(prev)
    case 'mode':
    case 'config':
    case 'usage':
    case 'info':
      // Session mode / config / usage / info updates aren't chat content — the
      // composer popover (mode/config/usage) and the onUpdate effect (info →
      // session title) consume them. Ignore in the transcript reducer.
      return done(prev)
    case 'end': {
      openText = false
      // Attach a result summary to the turn's last trace block (a closing
      // message block may sit after it).
      let ti = -1
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].kind === 'trace') {
          ti = i
          break
        }
      }
      if (ti < 0) return done(prev)
      const tb = blocks[ti] as Extract<Block, { kind: 'trace' }>
      const turnMs = replay ? tb.turnMs : ctx.turnStartAt ? now() - ctx.turnStartAt : tb.turnMs
      const result =
        tb.edits > 0 && !tb.result
          ? { text: `Applied changes to ${tb.edits} file${tb.edits > 1 ? 's' : ''}`, hasDiff: true }
          : tb.result
      const next = [...blocks]
      next[ti] = { ...tb, result, turnMs }
      return done(replaceTail(next))
    }
  }
}
