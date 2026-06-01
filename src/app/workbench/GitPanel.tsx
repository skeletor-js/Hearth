import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import type { GitStatus } from '../../../electron/main/self-mod/git-ops'

const TAG_LETTER: Record<string, string> = { new: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?' }

export function GitPanel({ anchor, onClose }: { anchor: { right: number; top: number }; onClose: () => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [message, setMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const refreshDiff = useSession((s) => s.refreshDiff)

  const reload = async () => {
    setStatus(await window.hearth.git.status())
  }
  useEffect(() => {
    void reload()
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
      refreshDiff()
    } finally {
      setBusy(false)
    }
  }

  const staged = status?.files.filter((f) => f.staged) ?? []
  const unstaged = status?.files.filter((f) => !f.staged) ?? []

  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={{ right: anchor.right, top: anchor.top, minWidth: 320, maxHeight: '70vh', overflow: 'auto' }}>
        <div className="pop-sect" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="git-branch" className="ico-13" /> {status?.branch ?? '…'}
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span style={{ color: 'var(--faint)' }}>
              {status.ahead > 0 && `↑${status.ahead}`} {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
        </div>

        {status && status.files.length === 0 && (
          <div className="pop-item" style={{ color: 'var(--subtle)' }}>
            <span className="pi-mark">
              <Icon name="check" />
            </span>
            <div className="pi-body">
              <div className="pi-name">Working tree clean</div>
            </div>
          </div>
        )}

        {unstaged.length > 0 && (
          <>
            <div className="pop-sect" style={{ display: 'flex', alignItems: 'center' }}>
              <span>Changes</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => run(() => window.hearth.git.stage([]))}>
                Stage all
              </button>
            </div>
            {unstaged.map((f) => (
              <div key={f.path} className="pop-item" style={{ cursor: 'default' }}>
                <span className={'tag ' + (f.tag === 'new' || f.tag === 'untracked' ? 'a' : 'm')}>{TAG_LETTER[f.tag]}</span>
                <div className="pi-body" style={{ minWidth: 0 }}>
                  <div className="pi-name" style={{ fontFamily: 'var(--mono)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.path}
                  </div>
                </div>
                <button className="btn-icon" title="Stage" disabled={busy} onClick={() => run(() => window.hearth.git.stage([f.path]))}>
                  <Icon name="plus" />
                </button>
              </div>
            ))}
          </>
        )}

        {staged.length > 0 && (
          <>
            <div className="pop-sect">Staged</div>
            {staged.map((f) => (
              <div key={f.path} className="pop-item" style={{ cursor: 'default' }}>
                <span className="tag a">{TAG_LETTER[f.tag]}</span>
                <div className="pi-body" style={{ minWidth: 0 }}>
                  <div className="pi-name" style={{ fontFamily: 'var(--mono)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.path}
                  </div>
                </div>
                <button className="btn-icon" title="Unstage" disabled={busy} onClick={() => run(() => window.hearth.git.unstage([f.path]))}>
                  <Icon name="minus" />
                </button>
              </div>
            ))}
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="composer-input"
                style={{ padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 7 }}
                placeholder="Commit message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                style={{ justifyContent: 'center' }}
                disabled={busy || !message.trim()}
                onClick={() =>
                  run(async () => {
                    await window.hearth.git.commit(message.trim())
                    setMessage('')
                  })
                }
              >
                <Icon name="check" /> Commit {staged.length} file{staged.length > 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        <div className="pop-sect">Branch</div>
        <div style={{ padding: '0 10px 10px', display: 'flex', gap: 8 }}>
          <input
            className="composer-input"
            style={{ padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 7, flex: 1 }}
            placeholder="new-branch-name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={busy || !newBranch.trim()}
            onClick={() =>
              run(async () => {
                await window.hearth.git.switchBranch(newBranch.trim(), true)
                setNewBranch('')
              })
            }
          >
            <Icon name="git-branch" /> Create
          </button>
        </div>
      </div>
    </>
  )
}
