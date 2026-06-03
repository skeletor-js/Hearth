import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/app/settings/controls'
import { toast } from '@/shell/toast'
import { useSession } from '../session-store'
import type { SelfModLogEntry, SelfModKind } from '../../../electron/main/self-mod/git'

const TITLE: Record<SelfModKind, { h1: string; sub: string; empty: string }> = {
  code: {
    h1: 'History',
    sub: 'Every time Hearth changes its own UI, prompts, or skills, it lands here as a commit. Undo reverts it — the live app follows.',
    empty: 'No self-edits yet. Ask Hearth to change itself and it shows up here.',
  },
  soul: {
    h1: 'Personality',
    sub: 'Changes to Hearth’s personality (the compiled Soul) are versioned here, separate from code.',
    empty: 'No personality changes yet. Adjust it in Settings.',
  },
  memory: {
    h1: 'Memory',
    sub: 'Changes to Hearth’s long-term memory are versioned here, separate from code.',
    empty: 'No memory changes yet. Say “remember this” in a session.',
  },
}

/** Group adjacent entries that share a runId (one turn's per-subagent commits are
 * made together, so they're contiguous in the log). null runId → singleton. */
function groupRuns(entries: SelfModLogEntry[]): Array<{ runId: string | null; members: SelfModLogEntry[] }> {
  const groups: Array<{ runId: string | null; members: SelfModLogEntry[] }> = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (e.runId && last && last.runId === e.runId) last.members.push(e)
    else groups.push({ runId: e.runId, members: [e] })
  }
  return groups
}

export function History() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<SelfModLogEntry[]>([])
  const [kind, setKind] = useState<SelfModKind>('code')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = () => void window.hearth.selfMod.history().then(setEntries)
  // Wrap in a thunk so the effect's return is undefined (no cleanup), not whatever
  // `load` returns — passing `load` directly is brittle if its signature changes.
  useEffect(() => {
    load()
  }, [])

  const shown = entries.filter((e) => e.kind === kind)
  const undone = shown.filter((e) => e.reverted).length

  const step = async (op: 'undo' | 'redo', hash: string, title: string) => {
    setBusy(hash)
    setNote(null)
    try {
      const r = op === 'undo' ? await window.hearth.selfMod.undo(hash) : await window.hearth.selfMod.redo(hash)
      if (r.status === 'ok') {
        toast(`${op === 'undo' ? 'Undone' : 'Redone'} · ${title}`)
        load()
      } else if (r.status === 'dirty') {
        setNote('You have uncommitted changes — commit or discard them before stepping history.')
      } else if (r.status === 'noop') {
        load()
      } else if (r.status === 'conflict') {
        // Model A: a non-latest revert can conflict. Hand it to Hearth's own agent to
        // resolve, routed through the normal chat send (transcript + UI).
        const active = useSession.getState().active
        const files = r.files.join(', ')
        if (active) {
          const verb = op === 'undo' ? 'Undo' : 'Redo'
          useSession
            .getState()
            .setPendingPrompt(
              `${verb} the self-edit "${title}" (commit ${hash.slice(0, 7)}). A \`git revert\` conflicts with later changes to ${files}. ` +
                `Perform the revert, resolve the conflict so the undo's intent is preserved, and commit it as a normal change.`,
            )
          toast(`Conflict — handing “${title}” to Hearth to resolve…`)
          void navigate({ to: '/chat' })
        } else {
          setNote(`“${title}” conflicts with later changes to ${files}. Open a session and ask Hearth to resolve it.`)
        }
      }
    } finally {
      setBusy(null)
    }
  }

  // Undo/redo every member of a run (file-disjoint, so order is safe). Reverts
  // sequentially through the shared `step` so conflicts still route to the agent.
  const stepRun = async (op: 'undo' | 'redo', members: SelfModLogEntry[]) => {
    const targets = members.filter((m) => (op === 'undo' ? !m.reverted : m.reverted))
    for (const m of targets) await step(op, m.hash, m.subject)
  }

  const row = (e: SelfModLogEntry, nested = false) => (
    <div
      key={e.hash}
      className={'card-row evo-row' + (e.reverted ? ' evo-undone' : '')}
      style={{ alignItems: 'flex-start', ...(nested ? { marginLeft: 22 } : {}) }}
    >
      <span className="cr-mark">
        <Icon name={e.reverted ? 'arrow-counter-clockwise' : 'flame'} fill={!e.reverted} />
      </span>
      <div className="cr-body">
        <div className="cr-title">
          <span className="evo-name">{e.subagent && nested ? e.subagent : e.subject}</span>
          {e.reverted ? (
            <span className="chip chip-sm evo-badge-undone">
              <Icon name="arrow-counter-clockwise" className="ico-12" /> Undone
            </span>
          ) : (
            <span className="chip chip-sm chip-accent">
              <Icon name="check" className="ico-12" /> Applied
            </span>
          )}
        </div>
        <div className="evo-stats">
          <span style={{ fontFamily: 'var(--mono)' }}>{e.hash.slice(0, 7)}</span>
        </div>
      </div>
      {e.reverted ? (
        <button className="btn btn-sm btn-quiet" disabled={busy === e.hash} onClick={() => step('redo', e.hash, e.subject)}>
          <Icon name="arrow-u-up-right" /> {busy === e.hash ? 'Redoing…' : 'Redo'}
        </button>
      ) : (
        <button className="btn btn-sm btn-quiet" disabled={busy === e.hash} onClick={() => step('undo', e.hash, e.subject)}>
          <Icon name="arrow-u-up-left" /> {busy === e.hash ? 'Undoing…' : 'Undo'}
        </button>
      )}
    </div>
  )

  const groups = groupRuns(shown)

  const t = TITLE[kind]
  return (
    <div className="screen scroll" data-screen-label="History">
      <div className="screen-inner narrow">
        <div className="screen-head">
          <span className="screen-head-ic">
            <Icon name={kind === 'soul' ? 'chat-text' : kind === 'memory' ? 'brain' : 'clock-counter-clockwise'} className="ico-20" />
          </span>
          <h1 className="screen-title">{t.h1}</h1>
        </div>
        <p className="screen-sub">{t.sub}</p>

        <div className="evo-toolbar">
          <Seg<SelfModKind>
            value={kind}
            options={[['code', 'History'], ['soul', 'Personality'], ['memory', 'Memory']]}
            onChange={setKind}
          />
          <span className="evo-state">
            {undone === 0 ? (
              <>
                <span className="dot ok" /> {shown.length} change{shown.length === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <span className="dot warn" /> {undone} undone · {shown.length} total
              </>
            )}
          </span>
        </div>

        {note && (
          <div className="card-row" style={{ marginTop: 12, color: 'var(--subtle)' }}>
            <span className="cr-mark">
              <Icon name="info" />
            </span>
            <div className="cr-body">
              <div className="cr-sub" style={{ whiteSpace: 'normal' }}>{note}</div>
            </div>
          </div>
        )}

        <div className="sec" style={{ marginTop: 18 }}>
          {shown.length === 0 ? (
            <div className="wb-empty" style={{ minHeight: 200 }}>
              <Icon name="clock-counter-clockwise" />
              <h3>{t.h1}</h3>
              <p>{t.empty}</p>
            </div>
          ) : (
            groups.map((g) => {
              if (g.members.length === 1) return row(g.members[0])
              // A parallel-subagent run: one expandable block, Undo/Redo all + per-member.
              const allUndone = g.members.every((m) => m.reverted)
              const base = g.members[0].subject.replace(/^[^:]+:\s*/, '')
              return (
                <div key={g.runId!} className="card-row evo-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="cr-mark">
                      <Icon name="git-branch" fill />
                    </span>
                    <div className="cr-body">
                      <div className="cr-title">
                        <span className="evo-name">{base}</span>
                        <span className="chip chip-sm">{g.members.length} parallel edits</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-quiet"
                      disabled={!!busy}
                      onClick={() => stepRun(allUndone ? 'redo' : 'undo', g.members)}
                    >
                      <Icon name={allUndone ? 'arrow-u-up-right' : 'arrow-u-up-left'} />{' '}
                      {allUndone ? 'Redo all' : 'Undo all'}
                    </button>
                  </div>
                  {g.members.map((m) => row(m, true))}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
