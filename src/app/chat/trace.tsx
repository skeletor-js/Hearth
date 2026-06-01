import { useState } from 'react'
import { Icon } from '@/shell/Icon'
import { renderMd, handleCodeCopyClick } from './markdown'
import type { AgentKind } from '../../../electron/shared/protocol'

export type StepKind = 'think' | 'search' | 'read' | 'edit' | 'run'
export type DiffRow = { t: 'add' | 'del' | 'ctx'; code: string; ln?: number }

export type TraceStep = {
  toolId?: string
  kind?: StepKind
  status: 'pending' | 'running' | 'done' | 'error'
  title: string
  diff?: { path: string; add: number; del: number; rows: DiffRow[] }
  /** Reasoning timing (live turns only; absent on replay). */
  startedAt?: number
  thinkMs?: number
}

function fmtSecs(ms?: number): string {
  if (!ms || ms < 400) return ''
  return ` for ${fmtDur(ms)}`
}
function fmtDur(ms: number): string {
  const s = ms / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
}

export type TraceResult = { text: string; hasDiff: boolean }

const TRACE_ICON: Record<StepKind, string> = {
  search: 'magnifying-glass',
  read: 'file-text',
  edit: 'pencil-simple',
  run: 'terminal-window',
  think: 'brain',
}

const BACKEND_META: Record<AgentKind, { icon: string; name: string }> = {
  claude: { icon: 'terminal-window', name: 'Claude' },
  codex: { icon: 'brackets-curly', name: 'Codex' },
}

/** Map a live tool-call title to a step kind for the timeline glyph. */
export function inferKind(title: string): StepKind | undefined {
  const t = title.toLowerCase()
  if (/\b(edit|write|create|patch|apply|update|multiedit)\b/.test(t)) return 'edit'
  if (/\b(read|view|cat|open|load)\b/.test(t)) return 'read'
  if (/\b(search|grep|glob|find|list|ls)\b/.test(t)) return 'search'
  if (/\b(bash|run|exec|terminal|shell|command|npm|node|git)\b/.test(t)) return 'run'
  return undefined
}

function Step({ step, running, isLast }: { step: TraceStep; running: boolean; isLast: boolean }) {
  const [open, setOpen] = useState(false)
  const isRunning = running && isLast && step.status !== 'error'

  // Reasoning: a quiet, collapsed "Thought" line that expands to the full text.
  if (step.kind === 'think') {
    return (
      <div className={'tstep' + (isLast ? ' is-last' : '')}>
        <div className={'tstep-node ' + (isRunning ? 'run' : 'done')}>
          {isRunning ? <span className="tspin" /> : <Icon name="brain" className="ico-12" />}
        </div>
        <div className="tstep-main">
          <div className="tstep-line tthink has-detail" onClick={() => setOpen((v) => !v)}>
            <span className="tverb plain">{isRunning ? 'Thinking…' : 'Thought' + fmtSecs(step.thinkMs)}</span>
            <Icon name="caret-right" className={'tchev ico-12' + (open ? ' open' : '')} />
          </div>
          {open && <div className="tstep-detail think-detail" onClick={handleCodeCopyClick} dangerouslySetInnerHTML={{ __html: renderMd(step.title) }} />}
        </div>
      </div>
    )
  }

  const status = isRunning ? 'run' : step.status === 'error' ? 'err' : step.status === 'done' ? 'done' : 'run'
  const hasDetail = !!step.diff

  return (
    <div className={'tstep' + (isLast ? ' is-last' : '')}>
      <div className={'tstep-node ' + status}>
        {isRunning ? (
          <span className="tspin" />
        ) : step.status === 'error' ? (
          <Icon name="x" className="ico-12" />
        ) : (
          <Icon name={step.kind ? TRACE_ICON[step.kind] : 'dot'} className="ico-12" />
        )}
      </div>
      <div className="tstep-main">
        <div
          className={'tstep-line' + (hasDetail ? ' has-detail' : '')}
          onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        >
          <span className="tverb plain">{step.title}</span>
          {step.diff && (
            <span className="tmeta diffmeta">
              {step.diff.add > 0 && <b className="add">+{step.diff.add}</b>}{' '}
              {step.diff.del > 0 && <b className="del">−{step.diff.del}</b>}
            </span>
          )}
          {isRunning && <span className="trun-lbl">running…</span>}
          {hasDetail && <Icon name="caret-right" className={'tchev ico-12' + (open ? ' open' : '')} />}
        </div>
        {open && step.diff && (
          <div className="tstep-detail diff-mini">
            {step.diff.rows.map((r, i) => (
              <div key={i} className={'dm-row ' + r.t}>
                <span className="dm-ln">{r.ln ?? ''}</span>
                <span className="dm-gut">{r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' '}</span>
                <span className="dm-code">{r.code}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function LiveTrace({
  steps,
  backend,
  running,
  result,
  durationMs,
  onOpenReview,
}: {
  steps: TraceStep[]
  backend: AgentKind
  running: boolean
  result?: TraceResult
  durationMs?: number
  onOpenReview?: () => void
}) {
  const be = BACKEND_META[backend]
  return (
    <div className="trace">
      <div className="trace-head">
        <span className={'trace-status' + (running ? ' run' : '')}>
          {running ? <span className="tspin big" /> : <Icon name="check-circle" fill className="ico-14" />}
        </span>
        <span className="trace-title">{running ? 'Working' : 'Worked'}</span>
        {!running && durationMs ? <span className="trace-elapsed">· {fmtDur(durationMs)}</span> : null}
        <span className="spacer" />
        <span className="trace-be">
          <Icon name={be.icon} className="ico-12" /> {be.name}
        </span>
      </div>

      <div className="trace-steps">
        {steps.map((s, i) => (
          <Step key={s.toolId ?? i} step={s} running={running} isLast={i === steps.length - 1} />
        ))}
      </div>

      {!running && result && (
        <div className="trace-result">
          <Icon name="check" className="ico-13" />
          <span className="tr-text">{result.text}</span>
          {result.hasDiff && onOpenReview && (
            <button className="tr-diff" onClick={onOpenReview}>
              <Icon name="git-diff" className="ico-12" /> View diff
            </button>
          )}
        </div>
      )}
    </div>
  )
}
