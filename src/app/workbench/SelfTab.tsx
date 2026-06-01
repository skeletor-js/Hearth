import { useState } from 'react'
import { Icon } from '@/shell/Icon'
import { FlameMark } from '@/shell/Mascot'
import { useSession } from '../session-store'

function basename(p: string): string {
  return p.split('/').pop() || p
}

export function SelfTab() {
  const edit = useSession((s) => s.lastSelfEdit)
  const setLastSelfEdit = useSession((s) => s.setLastSelfEdit)
  const refreshDiff = useSession((s) => s.refreshDiff)
  const [undoing, setUndoing] = useState(false)

  const undo = async () => {
    if (!edit || undoing) return
    setUndoing(true)
    try {
      await window.hearth.selfMod.undo(edit.commit)
      setLastSelfEdit({ ...edit, reverted: true })
      refreshDiff()
    } finally {
      setUndoing(false)
    }
  }

  return (
    <>
      <div className="self-banner">
        <span className="flame">
          <FlameMark size={17} />
        </span>
        <span>
          <b>Hearth is editing its own source.</b>
          <br />
          <span className="sub">
            Changes to the renderer, prompts, and skills live in this repo — and reload into the app you’re using.
          </span>
        </span>
      </div>

      {edit ? (
        <>
          <div className="ftree">
            {edit.changedPaths.map((p, i) => (
              <div key={i} className="ftree-row" style={{ height: 'auto', padding: '9px 10px', alignItems: 'flex-start' }}>
                <Icon name="pencil-simple" style={{ marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--strong)' }}>{p}</div>
                  <div style={{ fontSize: 'var(--t-12)', color: 'var(--subtle)', marginTop: 1 }}>{basename(p)}</div>
                </div>
                <span className="tag m" style={{ marginLeft: 'auto' }}>
                  mod
                </span>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                fontSize: 'var(--t-12)',
                color: 'var(--subtle)',
                marginBottom: 11,
              }}
            >
              <Icon name="arrow-counter-clockwise" className="ico-14" />
              Applied as commit <span style={{ fontFamily: 'var(--mono)' }}>{edit.commit.slice(0, 7)}</span> · roll back from{' '}
              <span style={{ fontFamily: 'var(--mono)' }}>History</span> too.
            </div>
            <button
              className={'btn' + (edit.reverted ? '' : ' btn-primary')}
              style={{ width: '100%', justifyContent: 'center', height: 34 }}
              onClick={edit.reverted ? undefined : undo}
              disabled={undoing || edit.reverted}
            >
              <Icon name={edit.reverted ? 'check-circle' : 'arrow-counter-clockwise'} fill={edit.reverted} />
              {edit.reverted ? 'Undone — Hearth reloaded' : undoing ? 'Undoing…' : 'Undo this self-edit'}
            </button>
          </div>
        </>
      ) : (
        <div className="wb-empty">
          <span className="flame" style={{ fontSize: 28, color: 'var(--accent)' }}>
            <FlameMark size={28} />
          </span>
          <h3>No self-edits yet</h3>
          <p>Ask Hearth to change itself — the latest edit and an Undo will appear here.</p>
        </div>
      )}
    </>
  )
}
