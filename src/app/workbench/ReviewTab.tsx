import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import type { DiffFile, DiffSummary } from '../../../electron/main/self-mod/git-diff'

function DiffView({ files }: { files: DiffFile[] }) {
  return (
    <div className="diff">
      {files.map((d) => (
        <div className="diff-file" key={(d.oldPath ?? '') + d.file}>
          <div className="diff-file-head">
            <Icon name={d.tag === 'new' ? 'file-plus' : d.tag === 'deleted' ? 'file-x' : 'pencil-simple'} />
            <span className="fname">{d.file}</span>
            <span className="spacer" />
            {d.add > 0 && (
              <span className="badge" style={{ color: 'var(--add)' }}>
                +{d.add}
              </span>
            )}
            {d.del > 0 && (
              <span className="badge" style={{ color: 'var(--del)' }}>
                −{d.del}
              </span>
            )}
          </div>
          {d.rows.map((r, j) =>
            r.t === 'hunk' ? (
              <div key={j} className="diff-row hunk">
                <span className="ln" />
                <span className="gut" />
                <span className="code">{r.code}</span>
              </div>
            ) : (
              <div key={j} className={'diff-row ' + r.t}>
                <span className="ln">{r.ln ?? ''}</span>
                <span className="gut">{r.t === 'add' ? '+' : r.t === 'del' ? '−' : ''}</span>
                <span className="code">{r.code}</span>
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  )
}

export function ReviewTab({ onOpenTab }: { onOpenTab: (id: string) => void }) {
  const [diff, setDiff] = useState<DiffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pr, setPr] = useState<string | null>(null)
  const diffNonce = useSession((s) => s.diffNonce)
  const setReviewCount = useSession((s) => s.setReviewCount)

  useEffect(() => {
    let live = true
    window.hearth.git
      .diff()
      .then((d) => {
        if (!live) return
        setDiff(d)
        setError(null)
        setReviewCount(d.files.length)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [diffNonce, setReviewCount])

  const draftPr = async () => {
    const title = diff?.branch ? `Changes on ${diff.branch}` : 'Hearth changes'
    const res = await window.hearth.git.createPr(title, '')
    setPr(res.created ? `Opened PR: ${res.detail}` : `Run: ${res.detail}`)
  }

  return (
    <>
      <div className="wb-subhead">
        <Icon name="git-branch" className="ico-13" />
        <span className="path">{diff?.branch ?? 'detached'}</span>
        <span className="spacer" />
        <span className="stat add">
          <Icon name="plus" className="ico-12" />
          {diff?.add ?? 0}
        </span>
        <span className="stat del">
          <Icon name="minus" className="ico-12" />
          {diff?.del ?? 0}
        </span>
        <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => onOpenTab('self')} title="Self-edits land in the Self tab">
          <Icon name="flame" /> Open in Self
        </button>
        <button className="btn btn-sm" onClick={draftPr}>
          <Icon name="git-pull-request" /> Draft PR
        </button>
      </div>
      {pr && (
        <div className="wb-subhead" style={{ color: 'var(--subtle)', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {pr}
        </div>
      )}
      {error ? (
        <div className="wb-empty">
          <Icon name="warning" />
          <h3>Couldn’t load changes</h3>
          <p>{error}</p>
        </div>
      ) : diff && diff.files.length === 0 ? (
        <div className="wb-empty">
          <Icon name="check-circle" />
          <h3>No changes</h3>
          <p>The working tree is clean.</p>
        </div>
      ) : diff ? (
        <DiffView files={diff.files} />
      ) : (
        <div className="wb-empty">
          <Icon name="git-diff" />
          <h3>Loading changes…</h3>
        </div>
      )}
    </>
  )
}
