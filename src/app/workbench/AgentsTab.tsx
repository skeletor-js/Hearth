// Live subagent activity panel (W4). Subscribes to self-mod:activity and shows,
// for the current turn, each subagent lane (Task), its status, and the files it's
// touching — plus a warning when two subagents write the same file. Clears when the
// run finalizes. See docs/completed-plans/SELF-MOD-HARDENING-PLAN.md (W4).

import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import type { RunActivity } from '../../../electron/main/self-mod/run-tracker'

const DOT: Record<string, string> = { pending: 'warn', running: 'warn', done: 'ok', error: 'err' }

export function AgentsTab() {
  const [activity, setActivity] = useState<RunActivity | null>(null)

  useEffect(() => window.hearth.selfMod.onActivity(setActivity), [])

  const lanes = activity?.lanes ?? []
  const collisions = activity?.collisions ?? []

  if (lanes.length === 0) {
    return (
      <div className="wb-empty" style={{ minHeight: 200 }}>
        <Icon name="users-three" />
        <h3>Agents</h3>
        <p>When Hearth runs parallel subagents, each one shows up here live with the files it's editing.</p>
      </div>
    )
  }

  return (
    <div className="screen scroll" data-screen-label="Agents">
      <div className="screen-inner">
        {collisions.length > 0 && (
          <div className="card-row" style={{ color: 'var(--warn)', marginBottom: 10 }}>
            <span className="cr-mark"><Icon name="warning" /></span>
            <div className="cr-body">
              <div className="cr-sub" style={{ whiteSpace: 'normal' }}>
                {collisions.length} file{collisions.length === 1 ? '' : 's'} edited by more than one subagent: {collisions.join(', ')}
              </div>
            </div>
          </div>
        )}
        {lanes.map((lane) => (
          <div key={lane.toolCallId} className="card-row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
            <span className="cr-mark"><span className={'dot ' + (DOT[lane.status] ?? 'warn')} /></span>
            <div className="cr-body">
              <div className="cr-title">
                <span className="evo-name">{lane.title || 'Subagent'}</span>
                <span className="chip" style={{ height: 18 }}>{lane.status}</span>
              </div>
              <div className="evo-stats" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                {lane.paths.length === 0 ? (
                  <span style={{ color: 'var(--faint)' }}>no files yet</span>
                ) : (
                  lane.paths.map((p) => (
                    <span key={p} style={{ fontFamily: 'var(--mono)', fontSize: 'var(--t-12)' }}>{p}</span>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
