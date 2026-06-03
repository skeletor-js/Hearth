import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import type { DiffFile, DiffSummary } from '../../../electron/main/self-mod/git-diff'
import type { PrResult } from '../../../electron/main/self-mod/git-ops'

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

/** A sensible default PR title + body derived from the diff. The user edits this
 * before creating — that's where agent-authored copy can be pasted if wanted. */
function draftFrom(diff: DiffSummary): { title: string; body: string } {
  const title = diff.branch ? `Changes on ${diff.branch}` : 'Hearth changes'
  const files = diff.files
    .map((f) => `- \`${f.file}\` (+${f.add}/−${f.del})`)
    .join('\n')
  const body =
    `## Summary\n` +
    `${diff.files.length} file${diff.files.length === 1 ? '' : 's'} changed · +${diff.add} / −${diff.del}.\n\n` +
    `## Files\n${files}\n`
  return { title, body }
}

const isUrl = (s: string): boolean => /^https?:\/\//.test(s.trim())

export function ReviewTab({ onOpenTab }: { onOpenTab: (id: string) => void }) {
  const [diff, setDiff] = useState<DiffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [result, setResult] = useState<PrResult | null>(null)
  const [creating, setCreating] = useState(false)
  const diffNonce = useSession((s) => s.diffNonce)
  const setReviewCount = useSession((s) => s.setReviewCount)
  const lastSelfEdit = useSession((s) => s.lastSelfEdit)
  const cwd = useSession((s) => s.active?.cwd)

  useEffect(() => {
    let live = true
    window.hearth.git
      .diff(cwd)
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
  }, [diffNonce, cwd, setReviewCount])

  const openDraft = () => {
    if (!diff) return
    setResult(null)
    setDraft(draftFrom(diff))
  }
  const createPr = async () => {
    if (!draft) return
    setCreating(true)
    try {
      const res = await window.hearth.git.createPr(draft.title, draft.body, cwd)
      setResult(res)
      if (res.created) setDraft(null)
    } finally {
      setCreating(false)
    }
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
        {lastSelfEdit && (
          <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => onOpenTab('self')} title="Undo Hearth’s last edit to its own code">
            <Icon name="flame" /> Self
          </button>
        )}
        <button className="btn btn-sm" disabled={!diff || diff.files.length === 0} onClick={openDraft}>
          <Icon name="git-pull-request" /> Draft PR
        </button>
      </div>

      {draft && (
        <div className="pr-draft">
          <input
            className="field"
            value={draft.title}
            placeholder="PR title"
            onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
          />
          <textarea
            className="pr-body"
            value={draft.body}
            placeholder="Describe the change…"
            onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
          />
          <div className="pr-draft-actions">
            <button className="btn btn-sm btn-primary" disabled={!draft.title.trim() || creating} onClick={createPr}>
              <Icon name="git-pull-request" /> {creating ? 'Creating…' : 'Create PR'}
            </button>
            <button className="btn btn-sm btn-quiet" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="pr-result">
          {result.created && isUrl(result.detail) ? (
            <>
              <Icon name="check-circle" fill style={{ color: 'var(--ok)' }} />
              <span>Pull request opened.</span>
              <button className="tr-diff" onClick={() => window.open(result.detail, '_blank')}>
                <Icon name="arrow-square-out" /> View on GitHub
              </button>
            </>
          ) : (
            <>
              <Icon name="terminal-window" style={{ color: 'var(--subtle)' }} />
              <span>Run this to open the PR (GitHub CLI not found):</span>
              <code>{result.detail}</code>
            </>
          )}
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
