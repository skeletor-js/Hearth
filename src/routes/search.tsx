import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { openSession } from '@/app/sessions'
import type { SessionSearchHit } from '../../electron/main/sessions/store'

export const Route = createFileRoute('/search')({ component: SearchScreen })

/** Split a snippet on the query (case-insensitive) and wrap matches in <mark>. */
function highlight(text: string, q: string): React.ReactNode {
  const needle = q.trim()
  if (!needle) return text
  const out: React.ReactNode[] = []
  const lower = text.toLowerCase()
  const lq = needle.toLowerCase()
  let i = 0
  let key = 0
  for (let at = lower.indexOf(lq); at >= 0; at = lower.indexOf(lq, i)) {
    if (at > i) out.push(text.slice(i, at))
    out.push(<mark key={key++}>{text.slice(at, at + needle.length)}</mark>)
    i = at + needle.length
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

function SearchScreen() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'all' | 'hearth'>('all')
  const [hits, setHits] = useState<SessionSearchHit[]>([])

  // Search runs in main (over transcripts on disk); debounce so each keystroke
  // doesn't re-read every file. Empty query returns the full session list.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void window.hearth.sessions.search(q).then((r) => live && setHits(r))
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const shown = useMemo(() => (scope === 'hearth' ? hits.filter((h) => h.meta.self) : hits), [hits, scope])

  const resume = (m: SessionSearchHit['meta']) => {
    openSession(m)
    void navigate({ to: '/chat' })
  }

  return (
    <div className="screen scroll" data-screen-label="Search">
      <div className="screen-inner narrow">
        <div className="search-field">
          <Icon name="magnifying-glass" style={{ color: 'var(--subtle)', fontSize: 'var(--t-18)' }} />
          <input
            autoFocus
            placeholder="Search sessions by title, workspace, or what was said…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="btn-icon" onClick={() => setQ('')}>
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="search-controls">
          <div className="mini-seg">
            <span className={'seg' + (scope === 'all' ? ' is-active' : '')} onClick={() => setScope('all')}>
              All sessions
            </span>
            <span className={'seg' + (scope === 'hearth' ? ' is-active' : '')} onClick={() => setScope('hearth')}>
              Hearth
            </span>
          </div>
          <span className="search-count">
            {shown.length} result{shown.length !== 1 ? 's' : ''}
          </span>
        </div>

        {shown.map((h) => (
          <div className="sresult" key={h.meta.id} onClick={() => resume(h.meta)}>
            <div className="sr-top">
              <Icon name={h.meta.self ? 'flame' : 'chat-circle'} fill={h.meta.self} style={{ color: 'var(--subtle)' }} />
              {h.meta.title}
              <span className="sr-scope">{h.meta.self ? 'Hearth' : h.meta.cwd}</span>
            </div>
            {h.snippet && <div className="sr-snip">{highlight(h.snippet, q)}</div>}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="wb-empty" style={{ minHeight: 180 }}>
            <Icon name="magnifying-glass" />
            <h3>No matches</h3>
            <p>{q ? `Nothing matches “${q}”.` : 'No sessions yet.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
