import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Icon } from './Icon'
import { FlameMark } from './Mascot'
import { Resizer } from './Resizer'
import { useShell } from './store'
import { useSession } from '@/app/session-store'
import { openSession, startSession } from '@/app/sessions'
import type { Workspace } from '../../electron/main/workspaces/registry'
import type { SessionMeta } from '../../electron/main/sessions/store'

const itemClass = (active: boolean) => 'rail-item' + (active ? ' is-selected' : '')
const footClass = (active: boolean) => 'foot-settings' + (active ? ' is-selected' : '')

export function Rail() {
  const { railW, theme, toggleTheme, resizeRail } = useShell()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const activeId = useSession((s) => s.active?.id)
  const sessionsNonce = useSession((s) => s.sessionsNonce)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recent, setRecent] = useState<SessionMeta[]>([])

  useEffect(() => {
    void window.hearth.workspaces.list().then(setWorkspaces)
    void window.hearth.sessions.list().then((l) => setRecent(l.slice(0, 8)))
  }, [sessionsNonce])

  const openFolder = async () => {
    const ws = await window.hearth.workspaces.open()
    if (!ws) return
    setWorkspaces(await window.hearth.workspaces.list())
    await startSession(ws)
    void navigate({ to: '/chat' })
  }

  const newInWorkspace = async (ws: Workspace) => {
    await startSession(ws)
    void navigate({ to: '/chat' })
  }

  // Start a fresh session in the current workspace (no prompt). Falls back to the
  // Hearth workspace, then the first available; with none, route home to pick one.
  // Flashes the workspace chip to signal it's changeable. See HOME-NEWSESSION plan.
  const newSession = async () => {
    const list = workspaces.length ? workspaces : await window.hearth.workspaces.list()
    const ws =
      list.find((w) => w.id === useSession.getState().active?.workspaceId) ??
      list.find((w) => w.isHearth) ??
      list[0]
    if (!ws) return navigate({ to: '/new' })
    await startSession(ws)
    useSession.getState().flashWorkspaceChip()
    void navigate({ to: '/chat' })
  }

  // ⌘N → New Session. Nothing else binds it (CommandPalette owns ⌘K only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void newSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // newSession closes over `workspaces`; rebind when it changes so the lookup is current.
  }, [workspaces])

  const resume = (m: SessionMeta) => {
    openSession(m)
    void navigate({ to: '/chat' })
  }

  return (
    <aside className="rail" style={{ width: railW }}>
      <div className="rail-top">
        <div className="rail-brand" title="Hearth">
          <span className="flame">
            <FlameMark size={19} />
          </span>
          <span>Hearth</span>
        </div>
      </div>

      <div className="rail-scroll scroll">
        <div className="rail-group">
          <button className="rail-item" onClick={() => void newSession()}>
            <Icon name="plus" />
            <span className="ri-label">New Session</span>
            <span className="ri-end">
              <kbd>⌘N</kbd>
            </span>
          </button>
          <Link to="/new" className={itemClass(pathname === '/new')}>
            <Icon name="house" />
            <span className="ri-label">Home</span>
          </Link>
          <Link to="/search" className={itemClass(pathname === '/search')}>
            <Icon name="magnifying-glass" />
            <span className="ri-label">Search</span>
            <span className="ri-end">
              <kbd>⌘K</kbd>
            </span>
          </Link>
          <Link to="/history" className={itemClass(pathname === '/history')}>
            <Icon name="clock-counter-clockwise" />
            <span className="ri-label">Changes</span>
          </Link>
        </div>

        <div className="rail-group">
          <div className="rail-group-label">
            <span>Workspaces</span>
            <button className="ricon" title="Open a folder" onClick={openFolder}>
              <Icon name="folder-simple-plus" />
            </button>
          </div>
          {workspaces.map((w) => (
            <button key={w.id} className="rail-item" onClick={() => newInWorkspace(w)} title={w.path}>
              <Icon name="folder" />
              <span className="ri-label">{w.name}</span>
            </button>
          ))}
        </div>

        <div className="rail-group">
          <div className="rail-group-label">
            <span>Recent</span>
          </div>
          {recent.length === 0 ? (
            <div className="rail-item" style={{ color: 'var(--faint)' }}>
              <span className="ri-label">No recent sessions</span>
            </div>
          ) : (
            recent.map((m) => (
              <button key={m.id} className={itemClass(m.id === activeId && pathname === '/chat')} onClick={() => resume(m)}>
                <Icon name="chat-circle" />
                <span className="ri-label">{m.title}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rail-foot">
        <button
          className={footClass(pathname === '/settings')}
          onClick={() =>
            navigate({ to: pathname === '/settings' ? (activeId ? '/chat' : '/new') : '/settings' })
          }
        >
          <Icon name="gear" />
          <span>Settings</span>
        </button>
        <button className="ricon" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon-stars'} />
        </button>
      </div>
      <Resizer axis="x" className="resizer-rail" onResize={resizeRail} />
    </aside>
  )
}
