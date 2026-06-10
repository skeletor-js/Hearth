import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentKind, PermissionRequest, PromptImage, SessionUpdate } from '../../../electron/shared/protocol'
import { FlameMark, ThinkingEmber } from '@/shell/Mascot'
import { Icon } from '@/shell/Icon'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import { usePresence } from '../presence-store'
import { ensureActiveSession } from '../sessions'
import { readScratchpad, wrapForPrompt } from '../scratchpad'
import { Composer } from './Composer'
import { humanizePermission } from './permission-verbs'
import { SaveAsTool } from './SaveAsTool'
import { toast } from '@/shell/toast'
import { LiveTrace } from './trace'
import { persistEntries } from '../transcript-persist'
import { renderMd, handleCodeCopyClick } from './markdown'
import { applyUpdate, EMPTY_TRANSCRIPT, type Msg, type TranscriptState } from './transcript-reducer'
import { pendingAfterSnapshot } from './replay-merge'

// Recap chip helpers (P5).
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}
function fmtAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 30) return 'just now'
  if (s < 60) return 'less than a minute ago'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    /* clipboard unavailable in this context */
  }
}

export function ChatView() {
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT)
  const msgs = transcript.msgs
  const [backend, setBackend] = useState<AgentKind>('claude')
  const nextId = useRef(0)
  const turnStart = useRef(0) // wall-clock turn start, for the "Worked · Ns" badge
  // Non-null while the active session's transcript is replaying: live updates
  // buffer here so history can never append below live content (U6/R-F8).
  const replayBuffer = useRef<SessionUpdate[] | null>(null)
  // Stick-to-bottom only when the user is already there (U6/R-F3): updated by
  // real scroll events, so it reflects the position BEFORE content grows.
  const atBottom = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const openRightTab = useShell((s) => s.openRightTab)
  // Stable handlers: MessageView is memoized (U11), and a per-render closure
  // would force every message to re-render on every streamed token anyway.
  const openReview = useCallback(() => openRightTab('review'), [openRightTab])
  const openPlan = useCallback(() => openRightTab('plan'), [openRightTab])
  const active = useSession((s) => s.active)
  // Busy + the pending permission ask are derived from presence (the bridge owns the
  // stream and folds them in by sessionId), so they survive switching sessions away
  // and back instead of resetting with this component. See docs/PRESENCE.md.
  const status = usePresence((s) => (active ? s.byId[active.id]?.status : undefined))
  const busy = status === 'thinking' || status === 'working' || status === 'waiting'
  const permission = usePresence((s) => (active ? s.byId[active.id]?.pendingPermission ?? null : null))
  // "While you were away" recap — a session that finished work while you were looking
  // at another one (P5). Reads the run summary the bridge accumulated into presence.
  const recap = usePresence((s) => (active ? s.byId[active.id] : undefined))
  const attach = useShell((s) => (active ? s.scratchpadAttach[active.cwd] ?? false : false))
  const setScratchpadAttach = useShell((s) => s.setScratchpadAttach)
  const padNonEmpty = useSession((s) => s.scratchpadNonEmpty)
  const promptReq = useSession((s) => s.promptRequest)
  const lastReqNonce = useRef(0)
  // Persist transcript entries INCREMENTALLY (each update as it streams), not
  // buffered until turn-end. A self-mod that edits the renderer can trigger a full
  // reload mid-turn, which would wipe an in-memory buffer before it flushed —
  // losing the whole assistant turn. Writing as we go makes the transcript durable
  // across that reload. `persistEntries` serializes per-session so the active and any
  // background session never interleave (see transcript-persist.ts).
  const persist = persistEntries

  // ids are allocated OUTSIDE the setMsgs updater. React may invoke an updater
  // twice (StrictMode/concurrent), and an updater must be pure — minting ids inside
  // it would burn ids and, worse, hand the live hearth bubble a different key across
  // invocations (remount/flicker). Allocating before setMsgs keeps the updater pure.
  const id = () => nextId.current++

  // `spawnTail` adds the empty hearth bubble that receives the streamed reply. Live
  // sends want it (shows the bubble immediately); replay does not — apply() creates
  // the tail when the first assistant update arrives, so two consecutive user
  // entries don't leave a dangling empty hearth row.
  const pushUser = (text: string, images?: PromptImage[], spawnTail = true) => {
    const uid = id()
    const hid = spawnTail ? id() : null
    setTranscript((p) => {
      const out: Msg[] = [...p.msgs, { id: uid, role: 'user', text, images }]
      if (hid !== null) out.push({ id: hid, role: 'hearth', blocks: [] })
      return { ...p, msgs: out }
    })
  }

  // Ensure there's a hearth message at the tail to receive stream blocks. `freshId`
  // is pre-allocated by the caller (outside the updater) and used only if a new tail
  // is needed; reusing the existing tail just leaves a harmless id gap.
  // The fold itself lives in transcript-reducer.ts (pure, unit-tested — U12);
  // this just supplies the pre-minted tail id + clock context. setPlan is passed
  // as the plan sink so the reducer stays dependency-free.
  const apply = (u: SessionUpdate, replay = false) => {
    const freshTailId = id()
    setTranscript((prev) =>
      applyUpdate(prev, u, {
        freshTailId,
        replay,
        turnStartAt: turnStart.current,
        onPlan: (entries) => useSession.getState().setPlan(entries),
      }),
    )
  }

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    const offBe = window.hearth.agent.onBackendChanged((s) => setBackend(s.kind))
    const offUpdate = window.hearth.agent.onUpdate(({ sessionId, update }) => {
      // Only the active session's stream drives this transcript — background sessions
      // are folded into presence by the shell bridge. Without this filter a background
      // turn would corrupt the on-screen transcript. See docs/PRESENCE.md.
      const a = useSession.getState().active
      if (!a || (sessionId && sessionId !== a.id)) return
      // Mid-replay live updates buffer for ordering; persistence below stays
      // immediate (the snapshot/buffer overlap is deduped at flush).
      if (replayBuffer.current) replayBuffer.current.push(update)
      else apply(update)
      // W9: agent-supplied session title — rename the active session + refresh the
      // rail. Not persisted as a transcript entry (it's metadata, not chat content).
      if (update.type === 'info') {
        void window.hearth.sessions.rename(a.id, update.title).then(() => useSession.getState().bumpSessions())
        return
      }
      // Persist this update immediately so a mid-turn renderer reload (e.g. a
      // self-mod that touches routes) can't lose the turn.
      persist(a.id, [{ kind: 'update', update }])
      if (update.type === 'end') {
        useSession.getState().refreshDiff() // working tree may have changed this turn
      }
    })
    const offError = window.hearth.agent.onError(({ sessionKey, message }) => {
      // Only this session's error belongs in this transcript; a background
      // session's death shows through presence (rail / banner), not here. A
      // null sessionKey (boot-time connect failure) lands on the open session.
      const a = useSession.getState().active
      if (sessionKey && sessionKey !== a?.id) return
      const sid = id()
      setTranscript((p) => ({ ...p, openText: false, msgs: [...p.msgs, { id: sid, role: 'system', text: `agent error: ${message}` }] }))
    })
    return () => {
      offBe()
      offUpdate()
      offError()
    }
  }, [])

  // Load (and replay) the active session's transcript when it changes; ensure one
  // exists on first entry. Replaying through `apply` rebuilds the surface exactly.
  useEffect(() => {
    let live = true
    setTranscript(EMPTY_TRANSCRIPT)
    replayBuffer.current = []
    atBottom.current = true // a fresh session opens pinned to the latest content
    if (!active) {
      void ensureActiveSession()
      return
    }
    void window.hearth.sessions.get(active.id).then((detail) => {
      if (!live) return // a newer switch owns the buffer now
      if (detail) {
        for (const e of detail.entries) {
          if (e.kind === 'user') pushUser(e.text, undefined, false)
          else apply(e.update, true)
        }
      }
      // Flush live updates that arrived during the replay — minus the front
      // already persisted into the snapshot we just replayed (see replay-merge).
      const buffered = replayBuffer.current ?? []
      replayBuffer.current = null
      for (const u of pendingAfterSnapshot(buffered, detail?.entries ?? [])) apply(u)
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
    if (atBottom.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, permission, busy])

  // Track whether the user sits at the bottom (scroll events fire for user and
  // programmatic scrolling alike, and BEFORE any content growth re-measures).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

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
    if (!permission || !active) return
    window.hearth.permission.respond(permission.id, optionId)
    usePresence.getState().setPermission(active.id, null)
  }

  const send = async (text: string, images?: PromptImage[]) => {
    const a = useSession.getState().active ?? (await ensureActiveSession())
    setTranscript((p) => (p.openText ? { ...p, openText: false } : p))
    pushUser(text, images)
    usePresence.getState().markSending(a.id)
    turnStart.current = Date.now()
    persist(a.id, [{ kind: 'user', text }])
    try {
      // Auto-attach: when on for this workspace, the agent sees the pad fenced in
      // front of the typed text, but the bubble + transcript keep only `text`.
      let outbound = text
      if (useShell.getState().scratchpadAttach[a.cwd]) {
        outbound = wrapForPrompt(text, await readScratchpad(a.cwd))
      }
      const result = await window.hearth.agent.prompt(a.id, a.cwd, outbound, images)
      if (result) {
        useSession.getState().setLastSelfEdit({ commit: result.commit, subject: text, changedPaths: result.changedPaths })
      }
    } catch (e) {
      const fid = id()
      setTranscript((p) => ({ ...p, msgs: [...p.msgs, { id: fid, role: 'system', text: `failed to send: ${String(e)}` }] }))
      usePresence.getState().setError(a.id)
    }
  }

  const stop = () => void window.hearth.agent.cancel(active?.id)

  // Save the current conversation as a reusable micro-app: scaffold an empty app,
  // then ask the agent to build it from what we just did. Only offered on the
  // Hearth self-session, where the agent's file tools can reach micro-apps/.
  const saveAsTool = async (slug: string) => {
    try {
      await window.hearth.microApps.create(slug)
    } catch (e) {
      const msg = String(e)
      toast(msg.includes('Already exists') ? `A tool named “${slug}” already exists` : `Couldn’t create tool: ${msg}`)
      return
    }
    toast(`Building tool “${slug}” — find it under Tools`)
    void send(
      `Turn our work in this conversation into a micro-app. I've scaffolded an empty one at micro-apps/${slug} ` +
        `(its own Vite + React project). Build the tool by editing micro-apps/${slug}/src/App.tsx (add files as needed) ` +
        `so it captures what we just did as a real, self-contained tool — not a placeholder. Stay within the scaffold's ` +
        `dependencies unless you genuinely need more.`,
    )
  }

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
          {active && recap?.unread && recap.edits > 0 && (
            <div className="recap">
              <Icon name="flame" fill className="ico-13" />
              <span>
                While you were away — edited {recap.edits} file{recap.edits > 1 ? 's' : ''}
                {recap.startedAt && recap.finishedAt ? ` · ${fmtDuration(recap.finishedAt - recap.startedAt)}` : ''}
                {recap.finishedAt ? ` · finished ${fmtAgo(recap.finishedAt)}` : ''}
              </span>
              <button className="recap-x" title="Dismiss" onClick={() => usePresence.getState().clearUnread(active.id)}>
                <Icon name="x" />
              </button>
            </div>
          )}
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
                onOpenReview={openReview}
                onOpenPlan={openPlan}
              />
            ))
          )}
          {permission && <ApproveCard req={permission} onAnswer={answer} />}
          {!busy && active?.self && msgs.some((m) => m.role === 'hearth') && <SaveAsTool onSave={saveAsTool} />}
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

// Memoized (U11): the reducer replaces only the tail message, so every earlier
// message keeps identity and skips re-render while the last one streams.
const MessageView = memo(function MessageView({
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
        {m.images && m.images.length > 0 && (
          <div className="msg-images">
            {m.images.map((img, i) => (
              <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="attachment" />
            ))}
          </div>
        )}
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
        if (b.kind === 'text') return <TextBlock key={i} text={b.text} />
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
})

// One markdown parse per distinct block text (U11): finished blocks have stable
// text, so only the still-streaming block re-parses per delta. DOMPurify stays
// on every agent-content sink (inside renderMd).
const TextBlock = memo(function TextBlock({ text }: { text: string }) {
  const html = useMemo(() => renderMd(text), [text])
  return <div className="msg-body" onClick={handleCodeCopyClick} dangerouslySetInnerHTML={{ __html: html }} />
})

function ApproveCard({ req, onAnswer }: { req: PermissionRequest; onAnswer: (optionId: string) => void }) {
  const primary = req.options.find((o) => o.kind === 'allow' || o.kind === 'allow-always')
  const reject = req.options.find((o) => o.kind === 'reject')
  const human = humanizePermission(req)
  return (
    <div className="approve">
      <div className="approve-head">
        <Icon name="seal-question" fill />
        <span>{human.lead}</span>
      </div>
      {human.detail && <div className="approve-detail">{human.detail}</div>}
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
