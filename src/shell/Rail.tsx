import { Link, useRouterState } from '@tanstack/react-router'
import { Icon, PanelBtn, RailIcon } from './Icon'
import { FlameMark } from './Mascot'
import { Resizer } from './Resizer'
import { useShell } from './store'

const COLLAPSED_NAV = [
  { to: '/new', icon: 'plus', title: 'New session' },
  { to: '/search', icon: 'magnifying-glass', title: 'Search' },
  { to: '/history', icon: 'clock-counter-clockwise', title: 'History' },
] as const

const itemClass = (active: boolean) => 'rail-item' + (active ? ' is-selected' : '')
const footClass = (active: boolean) => 'foot-settings' + (active ? ' is-selected' : '')

export function Rail() {
  const { railCollapsed, railW, toggleRail, theme, toggleTheme, resizeRail } = useShell()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (railCollapsed) {
    return (
      <aside className="rail">
        <div className="rail-top">
          <button className="rail-mark" title="Expand sidebar" onClick={toggleRail}>
            <RailIcon side="left" size={20} />
          </button>
        </div>
        <div className="rail-scroll scroll">
          <div className="rail-collapsed-only">
            {COLLAPSED_NAV.map((it) => (
              <Link key={it.to} to={it.to} title={it.title} className={itemClass(pathname === it.to)}>
                <Icon name={it.icon} />
              </Link>
            ))}
          </div>
        </div>
        <div className="rail-foot">
          <Link to="/settings" title="Settings" className={footClass(pathname === '/settings')}>
            <Icon name="gear" />
          </Link>
          <button className="ricon" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon-stars'} />
          </button>
        </div>
      </aside>
    )
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
        <PanelBtn side="left" on title="Collapse sidebar" onClick={toggleRail} />
      </div>

      <div className="rail-scroll scroll">
        <div className="rail-group">
          <Link to="/new" className={itemClass(pathname === '/new')}>
            <Icon name="plus" />
            <span className="ri-label">New session</span>
            <span className="ri-end">
              <kbd>⌘N</kbd>
            </span>
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
            <span className="ri-label">History</span>
          </Link>
        </div>

        {/* Workspaces + Recent are populated with live data in P3. */}
        <div className="rail-group">
          <div className="rail-group-label">
            <span>Workspaces</span>
            <Icon name="folder-simple-plus" />
          </div>
          <Link to="/chat" className={itemClass(pathname === '/chat')}>
            <Icon name="flame" fill />
            <span className="ri-label">Hearth</span>
          </Link>
        </div>

        <div className="rail-group">
          <div className="rail-group-label">
            <span>Recent</span>
          </div>
          <div className="rail-item" style={{ color: 'var(--faint)' }}>
            <span className="ri-label">No recent sessions</span>
          </div>
        </div>
      </div>

      <div className="rail-foot">
        <Link to="/settings" className={footClass(pathname === '/settings')}>
          <Icon name="gear" />
          <span>Settings</span>
        </Link>
        <button className="ricon" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon-stars'} />
        </button>
      </div>
      <Resizer axis="x" className="resizer-rail" onResize={resizeRail} />
    </aside>
  )
}
