import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from './Icon'
import { Topbar } from './Topbar'
import { useSession } from '@/app/session-store'

// The Session surface's top bar: a real breadcrumb (workspace › session title,
// the title editable in place) plus a session actions menu. Replaces the old
// hardcoded "Session" label.
export function SessionTopbar() {
  const active = useSession((s) => s.active)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (!active) {
    return (
      <Topbar>
        <span className="head">Session</span>
      </Topbar>
    )
  }

  const startRename = () => {
    setMenuOpen(false)
    setDraft(active.title)
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }
  const commitRename = () => {
    const title = draft.trim()
    setEditing(false)
    if (!title || title === active.title) return
    void window.hearth.sessions.rename(active.id, title)
    useSession.getState().setActive({ ...active, title })
    useSession.getState().bumpSessions()
  }
  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmDel(false)
  }
  const del = () => {
    void window.hearth.sessions.delete(active.id)
    closeMenu()
    useSession.getState().setActive(null)
    useSession.getState().bumpSessions()
    void navigate({ to: '/new' })
  }
  const flipKind = () => {
    const next = active.kind === 'knowledge' ? 'code' : 'knowledge'
    closeMenu()
    useSession.getState().setActiveKind(next)
    void window.hearth.sessions.setKind(active.id, next)
  }

  const menu = (
    <div className="more-wrap">
      <button className="btn-icon" title="Session actions" onClick={() => setMenuOpen((o) => !o)}>
        <Icon name="dots-three" />
      </button>
      {menuOpen && (
        <>
          <div className="menu-mask" onClick={closeMenu} />
          <div className="more-menu">
            <div className="more-item" onClick={startRename}>
              <Icon name="pencil-simple" /> Rename
            </div>
            <div className="more-item" onClick={() => { closeMenu(); void navigate({ to: '/new' }) }}>
              <Icon name="plus" /> New session
            </div>
            <div className="more-item" onClick={flipKind}>
              <Icon name={active.kind === 'knowledge' ? 'code' : 'briefcase'} />{' '}
              {active.kind === 'knowledge' ? 'Switch to developer view' : 'Switch to knowledge view'}
            </div>
            <div className="more-sep" />
            <div className="more-item danger" onClick={confirmDel ? del : () => setConfirmDel(true)}>
              <Icon name="trash" /> {confirmDel ? 'Click again to delete' : 'Delete session'}
            </div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <Topbar right={menu}>
      {editing ? (
        <input
          ref={inputRef}
          className="crumb-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
        />
      ) : (
        <span className="crumb-title" onDoubleClick={startRename} title="Double-click to rename">
          <span className="head">{active.title}</span>
          <button className="crumb-pencil" title="Rename" onClick={startRename}>
            <Icon name="pencil-simple" />
          </button>
        </span>
      )}
    </Topbar>
  )
}
