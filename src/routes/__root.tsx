import { useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { Rail } from '@/shell/Rail'
import { Topbar } from '@/shell/Topbar'
import { Resizer } from '@/shell/Resizer'
import { Icon, PanelBtn } from '@/shell/Icon'
import { useShell, applyTheme } from '@/shell/store'

export const Route = createRootRoute({ component: RootLayout })

const CRUMB: Record<string, string> = {
  '/chat': 'Session',
  '/new': 'New session',
  '/search': 'Search',
  '/history': 'History',
  '/settings': 'Settings',
}

// Placeholder workbench panel — replaced by the functional WorkPanel in P2-0.
const WB_TABS = [
  ['review', 'git-diff', 'Review'],
  ['self', 'flame', 'Self'],
  ['files', 'folder', 'Files'],
  ['terminal', 'terminal-window', 'Terminal'],
  ['browser', 'globe', 'Browser'],
  ['plan', 'list-checks', 'Plan'],
] as const

function PanelPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div className="wp">
      <div className="wb-tabbar">
        {WB_TABS.map(([id, icon, label], i) => (
          <div key={id} className={'wb-tab' + (i === 0 ? ' is-active' : '')}>
            <Icon name={icon} fill={id === 'self' && i === 0} />
            {label}
          </div>
        ))}
        <span className="spacer" />
        <div className="wb-actions">
          <button className="btn-icon" title="Open a tab">
            <Icon name="plus" />
          </button>
          <button className="btn-icon" title="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="wb-body scroll">
        <div className="wb-empty">
          <Icon name="cards-three" />
          <h3>Workbench</h3>
          <p>Review, Files, Terminal, Browser, and Plan land here.</p>
        </div>
      </div>
    </div>
  )
}

function RootLayout() {
  const s = useShell()
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  const isSession = pathname === '/chat'

  useEffect(() => {
    applyTheme(s.theme, s.accent, s.reduceMotion)
  }, [s.theme, s.accent, s.reduceMotion])

  const panelBtns = isSession ? (
    <div className="pbtn-group">
      <PanelBtn side="bottom" on={s.bottomOpen} title="Toggle bottom panel" onClick={() => s.setBottomOpen(!s.bottomOpen)} />
      <PanelBtn side="right" on={s.rightOpen} title="Toggle right panel" onClick={() => s.setRightOpen(!s.rightOpen)} />
    </div>
  ) : null

  const showRight = isSession && (s.layout === 'focus' || s.rightOpen)

  return (
    <div className="app" data-rail-collapsed={s.railCollapsed ? 'true' : 'false'} data-layout={isSession ? s.layout : undefined}>
      <Rail />
      <div className="stage">
        <div className="stage-row">
          <main className="main main-chat">
            <Topbar right={panelBtns}>
              <span className="head">{CRUMB[pathname] ?? 'Hearth'}</span>
            </Topbar>
            <Outlet />
          </main>
          {showRight && (
            <div className={'wb-col' + (s.layout === 'focus' && !s.rightOpen ? ' is-hidden' : '')} style={s.layout === 'split' ? undefined : { width: s.wbW }}>
              {s.layout !== 'focus' && <Resizer axis="x" className="resizer-wb" onResize={s.resizeWb} />}
              <PanelPlaceholder onClose={() => s.setRightOpen(false)} />
            </div>
          )}
          {isSession && s.layout === 'focus' && s.rightOpen && <div className="focus-scrim" onClick={() => s.setRightOpen(false)} />}
        </div>
        {isSession && s.bottomOpen && (
          <div className="wb-panel" style={{ height: s.panelH }}>
            <Resizer axis="y" className="resizer-panel" onResize={s.resizePanel} />
            <PanelPlaceholder onClose={() => s.setBottomOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
