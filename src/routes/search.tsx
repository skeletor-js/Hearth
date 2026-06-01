import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { openSession } from '@/app/sessions'
import type { SessionMeta } from '../../electron/main/sessions/store'

export const Route = createFileRoute('/search')({ component: SearchScreen })

function SearchScreen() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'all' | 'hearth'>('all')
  const [sessions, setSessions] = useState<SessionMeta[]>([])

  useEffect(() => {
    void window.hearth.sessions.list().then(setSessions)
  }, [])

  const hits = useMemo(() => {
    const base = scope === 'hearth' ? sessions.filter((s) => s.self) : sessions
    const needle = q.trim().toLowerCase()
    if (!needle) return base
    return base.filter((s) => (s.title + ' ' + s.cwd).toLowerCase().includes(needle))
  }, [sessions, scope, q])

  const resume = (m: SessionMeta) => {
    openSession(m)
    void navigate({ to: '/chat' })
  }

  return (
    <div className="screen scroll" data-screen-label="Search">
      <div className="screen-inner narrow">
        <div className="search-field">
          <Icon name="magnifying-glass" style={{ color: 'var(--subtle)', fontSize: 18 }} />
          <input autoFocus placeholder="Search sessions by title or workspace…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="btn-icon" onClick={() => setQ('')}>
              <Icon name="x" />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 14px' }}>
          <div className="mini-seg">
            <span className={'seg' + (scope === 'all' ? ' is-active' : '')} onClick={() => setScope('all')}>
              All sessions
            </span>
            <span className={'seg' + (scope === 'hearth' ? ' is-active' : '')} onClick={() => setScope('hearth')}>
              Hearth
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--t-12)', color: 'var(--faint)' }}>
            {hits.length} result{hits.length !== 1 ? 's' : ''}
          </span>
        </div>

        {hits.map((m) => (
          <div className="sresult" key={m.id} onClick={() => resume(m)}>
            <div className="sr-top">
              <Icon name={m.self ? 'flame' : 'chat-circle'} fill={m.self} style={{ color: 'var(--subtle)' }} />
              {m.title}
              <span className="sr-scope">{m.self ? 'Hearth' : m.cwd}</span>
            </div>
          </div>
        ))}
        {hits.length === 0 && (
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
