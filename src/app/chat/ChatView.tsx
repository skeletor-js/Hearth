import { useEffect, useRef, useState } from 'react'
import type { AgentKind, PermissionRequest, SessionUpdate } from '../../../electron/shared/protocol'
import { FlameMark, ThinkingEmber } from '@/shell/Mascot'
import { Icon } from '@/shell/Icon'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import { ensureActiveSession } from '../sessions'
import { readScratchpad, wrapForPrompt } from '../scratchpad'
import { Composer } from './Composer'
import { LiveTrace, inferKind, type DiffRow, type TraceResult, type TraceStep } from './trace'
import type { TranscriptEntry } from '../../../electron/main/sessions/store'
import { renderMd, handleCodeCopyClick } from './markdown'

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'trace'; steps: TraceStep[]; result?: TraceResult; edits: number; turnMs?: number }
  | { kind: 'planref'; done: number; total: number }
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'hearth'; blocks: Block[] }
  | { id: number; role: 'system'; text: string }

const MAX_DIFF_ROWS = 60

function basename(p: string): string {
  return p.split('/').pop() || p
}

function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    /* clipboard unavailable in this context */
  }
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
  const openThought = useRef(false) // streaming a single reasoning block (coalesce deltas)
  const turnStart = useRef(0) // wall-clock turn start, for the "Worked · Ns" badge
  const scrollRef = useRef<HTMLDivElement>(null)
  const openRightTab = useShell((s) => s.openRightTab)
  const active = useSession((s) => s.active)
  const attach = useShell((s) => (active ? s.scratchpadAttach[active.cwd] ?? false : false))
  const setScratchpadAttach = useShell((s) => s.setScratchpadAttach)
  const padNonEmpty = useSession((s) => s.scratchpadNonEmpty)
  const promptReq = useSession((s) => s.promptRequest)
  const lastReqNonce = useRef(0)
  // Persist transcript entries INCREMENTALLY (each update as it streams), not
  // buffered until turn-end. A self-mod that edits the renderer can trigger a full
  // reload mid-turn, which would wipe an in-memory buffer before it flushed —
  // losing the whole assistant turn. Writing as we go makes the transcript durable
  // across that reload. Appends are serialized through one promise chain so JSONL
  // lines never interleave and stay in stream order.
  const persistChain = useRef<Promise<unknown>>(Promise.resolve())
  const persist = (sessionId: string, entries: TranscriptEntry[]) => {
    if (!entries.length) return
    persistChain.current = persistChain.current
      .then(() => window.hearth.sessions.append(sessionId, entries))
      .catch(() => {})
  }

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

  const apply = (u: SessionUpdate, replay = false) =>
    setMsgs((prev0) => {
      const [prev, tail] = withHearthTail(prev0)
      const blocks = tail.blocks
      const lastBlock = blocks[blocks.length - 1]
      // Any non-thought update ends the current reasoning run.
      if (u.type !== 'thought') openThought.current = false

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
          const last = steps[steps.length - 1]
          // Coalesce streaming deltas of one reasoning block into a single step
          // instead of spawning a node per chunk.
          if (openThought.current && last?.kind === 'think') {
            const next = [...steps]
            next[next.length - 1] = {
              ...last,
              title: last.title + u.text,
              thinkMs: last.startedAt ? Date.now() - last.startedAt : last.thinkMs,
            }
            return rebuild(next)
          }
          openThought.current = true
          return rebuild([...steps, { kind: 'think', status: 'done', title: u.text, startedAt: replay ? undefined : Date.now() }])
        }
        case 'tool-call': {
          openText.current = false
          // The agent's internal tool-discovery is plumbing, not a user-facing step.
          if (/^tool\s*search$/i.test(u.title.trim())) return prev
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
        case 'commands':
          // The agent's advertised slash commands / skills are captured for
          // Settings, never rendered into the chat transcript.
          return prev
        case 'mode':
        case 'config':
        case 'usage':
          // Session mode / config-option / usage updates aren't chat content —
          // the composer's agent-settings popover consumes them. Ignore here.
          return prev
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
          if (ti < 0) return prev
          const tb = blocks[ti] as Extract<Block, { kind: 'trace' }>
          const turnMs = replay ? tb.turnMs : turnStart.current ? Date.now() - turnStart.current : tb.turnMs
          const result =
            tb.edits > 0 && !tb.result
              ? { text: `Applied changes to ${tb.edits} file${tb.edits > 1 ? 's' : ''}`, hasDiff: true }
              : tb.result
          const next = [...blocks]
          next[ti] = { ...tb, result, turnMs }
          return replaceTail(next)
        }
      }
    })

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    const offBe = window.hearth.agent.onBackendChanged((s) => setBackend(s.kind))
    const offUpdate = window.hearth.agent.onUpdate(({ update }) => {
      apply(update)
      // Persist this update immediately so a mid-turn renderer reload (e.g. a
      // self-mod that touches routes) can't lose the turn.
      const a = useSession.getState().active
      if (a) persist(a.id, [{ kind: 'update', update }])
      if (update.type === 'end') {
        setBusy(false)
        useSession.getState().refreshDiff() // working tree may have changed this turn
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
    if (!active) {
      void ensureActiveSession()
      return
    }
    void window.hearth.sessions.get(active.id).then((detail) => {
      if (!live) return
      if (detail) {
        for (const e of detail.entries) {
          if (e.kind === 'user') pushUser(e.text)
          else apply(e.update, true)
        }
      }
      // A prompt queued elsewhere (e.g. a History revert conflict) sends here,
      // after the transcript is restored, through the normal send path.
      const pending = useSession.getState().pendingPrompt
      if (pending) {
        useSession.getState().setPendingPrompt(null)
        void send(pending)
      }
    })
    return () => {
      live = false
    }
  }, [active?.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, permission, busy])

  // Seed the scratchpad-has-content flag for the chip, even if the tab was never
  // opened this session. The tab keeps it fresh while open.
  useEffect(() => {
    const cwd = active?.cwd
    if (!cwd) return useSession.getState().setScratchpadNonEmpty(false)
    let live = true
    void readScratchpad(cwd).then((p) => live && useSession.getState().setScratchpadNonEmpty(p.trim().length > 0))
    return () => {
      live = false
    }
  }, [active?.cwd])

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
    turnStart.current = Date.now()
    persist(a.id, [{ kind: 'user', text }])
    try {
      // Auto-attach: when on for this workspace, the agent sees the pad fenced in
      // front of the typed text, but the bubble + transcript keep only `text`.
      let outbound = text
      if (useShell.getState().scratchpadAttach[a.cwd]) {
        outbound = wrapForPrompt(text, await readScratchpad(a.cwd))
      }
      const result = await window.hearth.agent.prompt(a.id, a.cwd, outbound)
      if (result) {
        useSession.getState().setLastSelfEdit({ commit: result.commit, subject: text, changedPaths: result.changedPaths })
      }
    } catch (e) {
      setMsgs((p) => [...p, { id: id(), role: 'system', text: `failed to send: ${String(e)}` }])
      setBusy(false)
    }
  }

  const stop = () => void window.hearth.agent.cancel()

  // A "send now" request from the Scratchpad, routed through the normal send path.
  // No-op while a turn is in flight (the nonce still advances, so it's dropped, not
  // queued — matches the disabled Send button).
  useEffect(() => {
    if (!promptReq || promptReq.nonce === lastReqNonce.current) return
    lastReqNonce.current = promptReq.nonce
    if (busy) return
    void send(promptReq.text)
  }, [promptReq, busy])

  const lastUser = [...msgs].reverse().find((x) => x.role === 'user')
  const lastUserText = lastUser && lastUser.role === 'user' ? lastUser.text : null

  return (
    <div className="chat-col" data-screen-label="Chat">
      <div className="chat-scroll scroll" ref={scrollRef}>
        <div className="chat-wrap">
          {msgs.length === 0 && !busy ? (
            <div className="chat-empty">
              <span className="flame">
                <FlameMark size={26} />
              </span>
              <h3>Ready when you are</h3>
              <p>Ask Hearth to build, explain, or change something — including itself.</p>
            </div>
          ) : (
            msgs.map((m, i) => (
              <MessageView
                key={m.id}
                m={m}
                backend={backend}
                busy={busy}
                isLast={i === msgs.length - 1}
                onRetry={!busy && i === msgs.length - 1 && m.role === 'hearth' && lastUserText ? () => void send(lastUserText) : undefined}
                onOpenReview={() => openRightTab('review')}
                onOpenPlan={() => openRightTab('plan')}
              />
            ))
          )}
          {permission && <ApproveCard req={permission} onAnswer={answer} />}
        </div>
      </div>
      <Composer
        busy={busy}
        onSend={send}
        onStop={stop}
        scratchpadAttached={attach && padNonEmpty}
        onDetachScratchpad={() => active && setScratchpadAttach(active.cwd, false)}
      />
    </div>
  )
}

function MessageView({
  m,
  backend,
  busy,
  isLast,
  onRetry,
  onOpenReview,
  onOpenPlan,
}: {
  m: Msg
  backend: AgentKind
  busy: boolean
  isLast: boolean
  onRetry?: () => void
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
          <span className="spacer" />
          <div className="msg-actions">
            <button className="msg-act" title="Copy" onClick={() => copyText(m.text)}>
              <Icon name="copy" />
            </button>
            <button className="msg-act" title="Edit & resend" onClick={() => useSession.getState().setComposerDraft(m.text)}>
              <Icon name="pencil-simple" />
            </button>
          </div>
        </div>
        <div className="msg-body">{m.text}</div>
      </div>
    )
  }
  const liveTurn = busy && isLast
  return (
    <div className="msg hearth">
      <div className="msg-role">
        <span className="who">Hearth</span>
        <span className="spacer" />
        {m.blocks.length > 0 && (
          <div className="msg-actions">
            <button
              className="msg-act"
              title="Copy answer"
              onClick={() => copyText(m.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join('\n\n'))}
            >
              <Icon name="copy" />
            </button>
            {onRetry && (
              <button className="msg-act" title="Retry" onClick={onRetry}>
                <Icon name="arrow-clockwise" />
              </button>
            )}
          </div>
        )}
      </div>
      {m.blocks.length === 0 && liveTurn && (
        <div style={{ marginTop: 4 }}>
          <ThinkingEmber label="Hearth is thinking" />
        </div>
      )}
      {m.blocks.map((b, i) => {
        if (b.kind === 'text') return <div key={i} className="msg-body" onClick={handleCodeCopyClick} dangerouslySetInnerHTML={{ __html: renderMd(b.text) }} />
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
            durationMs={b.turnMs}
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
