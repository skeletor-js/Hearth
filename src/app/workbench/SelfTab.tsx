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
              <div key={i} className="ftree-row self-file">
                <Icon name="pencil-simple" />
                <div className="sf-body">
                  <div className="sf-path">{p}</div>
                  <div className="sf-name">{basename(p)}</div>
                </div>
                <span className="tag m">mod</span>
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
              <span style={{ fontFamily: 'var(--mono)' }}>Changes</span> too.
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
          <Icon name="pencil-simple" />
          <h3>No self-edits yet</h3>
          <p>
            This shows the last change Hearth makes to its own code, with a one-click Undo. The full timeline lives in
            Changes; the working-tree diff lives in Review.
          </p>
        </div>
      )}
    </>
  )
}
