import { useEffect, useRef, useState } from 'react'
import type { AgentKind, PermissionRequest, SessionUpdate } from '../../../electron/shared/protocol'
import { FlameMark, ThinkingEmber } from '@/shell/Mascot'
import { Icon } from '@/shell/Icon'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import { ensureActiveSession } from '../sessions'
import { Composer } from './Composer'
import { LiveTrace, inferKind, type DiffRow, type TraceResult, type TraceStep } from './trace'
import type { TranscriptEntry } from '../../../electron/main/sessions/store'

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'trace'; steps: TraceStep[]; result?: TraceResult; edits: number }
  | { kind: 'planref'; done: number; total: number }
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'hearth'; blocks: Block[] }
  | { id: number; role: 'system'; text: string }

const MAX_DIFF_ROWS = 60

function basename(p: string): string {
  return p.split('/').pop() || p
}

function diffRows(oldText: string | null, newText: string): { add: number; del: number; rows: DiffRow[] } {
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

export function ChatView() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [backend, setBackend] = useState<AgentKind>('claude')
  const nextId = useRef(0)
  const openText = useRef(false) // last hearth block is a coalescing text block
  const scrollRef = useRef<HTMLDivElement>(null)
  const openRightTab = useShell((s) => s.openRightTab)
  const active = useSession((s) => s.active)
  // Buffer of stream entries for the in-flight turn, flushed to the transcript
  // on end so we persist per-turn (not per-token).
  const turnBuffer = useRef<TranscriptEntry[]>([])

  const id = () => nextId.current++

  const pushUser = (text: string) =>
    setMsgs((p) => [...p, { id: id(), role: 'user', text }, { id: id(), role: 'hearth', blocks: [] }])

  // Ensure there's a hearth message at the tail to receive stream blocks.
  const withHearthTail = (prev: Msg[]): [Msg[], Extract<Msg, { role: 'hearth' }>] => {
    const last = prev[prev.length - 1]
    if (last?.role === 'hearth') return [prev, last]
    const fresh: Msg = { id: id(), role: 'hearth', blocks: [] }
    return [[...prev, fresh], fresh as Extract<Msg, { role: 'hearth' }>]
  }

  const apply = (u: SessionUpdate) =>
    setMsgs((prev0) => {
      const [prev, tail] = withHearthTail(prev0)
      const blocks = tail.blocks
      const lastBlock = blocks[blocks.length - 1]

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
          if (openText.current && lastBlock?.kind === 'text') {
            return replaceTail([...blocks.slice(0, -1), { kind: 'text', text: lastBlock.text + u.text }])
          }
          openText.current = true
          return replaceTail([...blocks, { kind: 'text', text: u.text }])
        }
        case 'plan': {
          openText.current = false
          useSession.getState().setPlan(u.entries)
          const done = u.entries.filter((e) => e.status === 'completed').length
          const ref: Block = { kind: 'planref', done, total: u.entries.length }
          const pi = blocks.findIndex((b) => b.kind === 'planref')
          if (pi >= 0) {
            const next = [...blocks]
            next[pi] = ref
            return replaceTail(next)
          }
          return replaceTail([...blocks, ref])
        }
        case 'thought': {
          openText.current = false
          const { steps, rebuild } = ensureTrace()
          return rebuild([...steps, { kind: 'think', status: 'done', title: u.text }])
        }
        case 'tool-call': {
          openText.current = false
          const { steps, rebuild } = ensureTrace()
          const i = steps.findIndex((s) => s.toolId === u.id)
          if (i >= 0) {
            const next = [...steps]
            next[i] = { ...next[i], title: u.title, status: u.status, kind: next[i].kind ?? inferKind(u.title) }
            return rebuild(next)
          }
          return rebuild([...steps, { toolId: u.id, kind: inferKind(u.title), status: u.status, title: u.title }])
        }
        case 'diff': {
          openText.current = false
          const curEdits = lastBlock?.kind === 'trace' ? lastBlock.edits : 0
          const { steps, rebuild } = ensureTrace()
          const d = diffRows(u.oldText, u.newText)
          const diff = { path: u.path, add: d.add, del: d.del, rows: d.rows }
          // Attach to the most recent step (the tool-call that just produced it).
          if (steps.length && steps[steps.length - 1].kind !== 'think') {
            const next = [...steps]
            const s = next[next.length - 1]
            next[next.length - 1] = { ...s, kind: 'edit', diff }
            return rebuild(next, curEdits + 1)
          }
          return rebuild([...steps, { kind: 'edit', status: 'done', title: `Edit ${basename(u.path)}`, diff }], curEdits + 1)
        }
        case 'end': {
          openText.current = false
          // Attach a result summary to the turn's last trace block (a closing
          // message block may sit after it).
          let ti = -1
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].kind === 'trace') {
              ti = i
              break
            }
          }
          if (ti >= 0) {
            const tb = blocks[ti] as Extract<Block, { kind: 'trace' }>
            if (tb.edits > 0 && !tb.result) {
              const next = [...blocks]
              next[ti] = {
                ...tb,
                result: { text: `Applied changes to ${tb.edits} file${tb.edits > 1 ? 's' : ''}`, hasDiff: true },
              }
              return replaceTail(next)
            }
          }
          return prev
        }
      }
    })

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    const offBe = window.hearth.agent.onBackendChanged((s) => setBackend(s.kind))
    const offUpdate = window.hearth.agent.onUpdate(({ update }) => {
      apply(update)
      turnBuffer.current.push({ kind: 'update', update })
      if (update.type === 'end') {
        setBusy(false)
        useSession.getState().refreshDiff() // working tree may have changed this turn
        const a = useSession.getState().active
        const batch = turnBuffer.current
        turnBuffer.current = []
        if (a && batch.length) void window.hearth.sessions.append(a.id, batch)
      }
    })
    const offError = window.hearth.agent.onError((message) => {
      openText.current = false
      setMsgs((p) => [...p, { id: id(), role: 'system', text: `agent error: ${message}` }])
      setBusy(false)
    })
    const offPermission = window.hearth.permission.onRequest(({ req }) => setPermission(req))
    return () => {
      offBe()
      offUpdate()
      offError()
      offPermission()
    }
  }, [])

  // Load (and replay) the active session's transcript when it changes; ensure one
  // exists on first entry. Replaying through `apply` rebuilds the surface exactly.
  useEffect(() => {
    let live = true
    setMsgs([])
    openText.current = false
    turnBuffer.current = []
    if (!active) {
      void ensureActiveSession()
      return
    }
    void window.hearth.sessions.get(active.id).then((detail) => {
      if (!live || !detail) return
      for (const e of detail.entries) {
        if (e.kind === 'user') pushUser(e.text)
        else apply(e.update)
      }
    })
    return () => {
      live = false
    }
  }, [active?.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, permission, busy])

  const answer = (optionId: string) => {
    if (!permission) return
    window.hearth.permission.respond(permission.id, optionId)
    setPermission(null)
  }

  const send = async (text: string) => {
    const a = useSession.getState().active ?? (await ensureActiveSession())
    openText.current = false
    pushUser(text)
    setBusy(true)
    void window.hearth.sessions.append(a.id, [{ kind: 'user', text }])
    try {
      const result = await window.hearth.agent.prompt(a.id, a.cwd, text)
      if (result) {
        useSession.getState().setLastSelfEdit({ commit: result.commit, subject: text, changedPaths: result.changedPaths })
      }
    } catch (e) {
      setMsgs((p) => [...p, { id: id(), role: 'system', text: `failed to send: ${String(e)}` }])
      setBusy(false)
    }
  }

  const stop = () => void window.hearth.agent.cancel()

  return (
    <div className="chat-col" data-screen-label="Chat">
      <div className="chat-scroll scroll" ref={scrollRef}>
        <div className="chat-wrap">
          {msgs.map((m, i) => (
            <MessageView
              key={m.id}
              m={m}
              backend={backend}
              busy={busy}
              isLast={i === msgs.length - 1}
              onOpenReview={() => openRightTab('review')}
              onOpenPlan={() => openRightTab('plan')}
            />
          ))}
          {permission && <ApproveCard req={permission} onAnswer={answer} />}
        </div>
      </div>
      <Composer busy={busy} onSend={send} onStop={stop} />
    </div>
  )
}

function MessageView({
  m,
  backend,
  busy,
  isLast,
  onOpenReview,
  onOpenPlan,
}: {
  m: Msg
  backend: AgentKind
  busy: boolean
  isLast: boolean
  onOpenReview: () => void
  onOpenPlan: () => void
}) {
  if (m.role === 'system') {
    return (
      <div className="msg hearth">
        <div className="msg-body" style={{ color: 'var(--warn)' }}>
          {m.text}
        </div>
      </div>
    )
  }
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="msg-role">
          <span className="who">You</span>
        </div>
        <div className="msg-body">{m.text}</div>
      </div>
    )
  }
  const liveTurn = busy && isLast
  return (
    <div className="msg hearth">
      <div className="msg-role">
        <span className="flame">
          <FlameMark size={14} />
        </span>
        <span className="who">Hearth</span>
      </div>
      {m.blocks.length === 0 && liveTurn && (
        <div style={{ marginTop: 4 }}>
          <ThinkingEmber label="Hearth is thinking" />
        </div>
      )}
      {m.blocks.map((b, i) => {
        if (b.kind === 'text') return <div key={i} className="msg-body" style={{ whiteSpace: 'pre-wrap' }}>{b.text}</div>
        if (b.kind === 'planref')
          return (
            <div key={i} className="wb-ref" onClick={onOpenPlan}>
              <Icon name="list-checks" />
              <span>
                <b>Plan</b>
                <span style={{ color: 'var(--subtle)' }}>
                  {' '}
                  · {b.done}/{b.total} done
                </span>
              </span>
              <Icon name="arrow-up-right" className="arrow" />
            </div>
          )
        const running = liveTurn && i === m.blocks.length - 1
        return (
          <LiveTrace
            key={i}
            steps={b.steps}
            backend={backend}
            running={running}
            result={b.result}
            onOpenReview={onOpenReview}
          />
        )
      })}
    </div>
  )
}

function ApproveCard({ req, onAnswer }: { req: PermissionRequest; onAnswer: (optionId: string) => void }) {
  const primary = req.options.find((o) => o.kind === 'allow' || o.kind === 'allow-always')
  const reject = req.options.find((o) => o.kind === 'reject')
  return (
    <div className="approve">
      <div className="approve-head">
        <Icon name="seal-question" fill />
        <span>{req.title}</span>
      </div>
      <div className="approve-foot" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <span className="scope">
          <Icon name="shield-check" className="ico-13" /> This session
        </span>
        {req.options
          .filter((o) => o !== primary && o !== reject)
          .map((o) => (
            <button key={o.id} className="btn btn-sm btn-quiet" onClick={() => onAnswer(o.id)}>
              {o.label}
            </button>
          ))}
        {reject && (
          <button className="btn btn-sm btn-quiet" onClick={() => onAnswer(reject.id)}>
            {reject.label}
          </button>
        )}
        {primary && (
          <button className="btn btn-sm btn-primary" onClick={() => onAnswer(primary.id)}>
            <Icon name="check" /> {primary.label}
          </button>
        )}
      </div>
    </div>
  )
}
