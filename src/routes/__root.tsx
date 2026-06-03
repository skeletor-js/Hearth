import { useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { Rail } from '@/shell/Rail'
import { Topbar } from '@/shell/Topbar'
import { SessionTopbar } from '@/shell/SessionTopbar'
import { Resizer } from '@/shell/Resizer'
import { PanelBtn } from '@/shell/Icon'
import { useShell, applyTheme } from '@/shell/store'
import { WorkPanel } from '@/app/workbench/WorkPanel'
import { CommandPalette, useCommandPalette } from '@/shell/CommandPalette'
import { Onboarding } from '@/shell/Onboarding'
import { Toaster } from '@/shell/toast'

export const Route = createRootRoute({ component: RootLayout })

const CRUMB: Record<string, string> = {
  '/new': 'New session',
  '/search': 'Search',
  '/history': 'Changes',
  '/settings': 'Settings',
}

function RootLayout() {
  const s = useShell()
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  const isSession = pathname === '/chat'

  useEffect(() => {
    applyTheme(s.theme, s.accent, s.reduceMotion)
  }, [s.theme, s.accent, s.reduceMotion])

  // Off-session, panels are plain open/closed surfaces — the focus/split machinery
  // (data-layout, scrim) is session-only, so right visibility is just `rightOpen`.
  const showRight = isSession ? s.layout === 'focus' || s.rightOpen : s.rightOpen
  const cmdk = useCommandPalette()

  if (!s.onboarded) {
    return (
      <div className="app">
        <Titlebar />
        <Onboarding />
        <Toaster />
      </div>
    )
  }

  return (
    <div className="app" data-layout={isSession ? s.layout : undefined}>
      <Titlebar />
      {cmdk.open && <CommandPalette onClose={() => cmdk.setOpen(false)} />}
      <Toaster />
      {!s.railHidden && <Rail />}
      <div className="stage">
        <div className="stage-row">
          <main className="main main-chat">
            {isSession ? (
              <SessionTopbar />
            ) : (
              <Topbar>
                <span className="head">{CRUMB[pathname] ?? 'Hearth'}</span>
              </Topbar>
            )}
            <Outlet />
          </main>
          {showRight && (
            <div
              className={'wb-col' + (isSession && s.layout === 'focus' && !s.rightOpen ? ' is-hidden' : '')}
              style={isSession && s.layout === 'split' ? undefined : { width: s.wbW }}
            >
              {(!isSession || s.layout !== 'focus') && <Resizer axis="x" className="resizer-wb" onResize={s.resizeWb} />}
              <WorkPanel orientation="right" tab={s.rightTab} setTab={s.openRightTab} offSession={!isSession} />
            </div>
          )}
          {isSession && s.layout === 'focus' && s.rightOpen && <div className="focus-scrim" onClick={() => s.setRightOpen(false)} />}
        </div>
        {s.bottomOpen && (
          <div className="wb-panel" style={{ height: s.panelH }}>
            <Resizer axis="y" className="resizer-panel" onResize={s.resizePanel} />
            <WorkPanel orientation="bottom" tab={s.bottomTab} setTab={s.setBottomTab} offSession={!isSession} />
          </div>
        )}
      </div>
    </div>
  )
}

// The macOS title-bar safe strip: reserves room for the traffic lights, lets the
// user drag the window, zooms (fill ⟷ restore) on double-click, and hosts the
// panel-toggle buttons. The left toggle (right of the traffic lights) fully
// shows/hides the sidebar; the right-aligned pair toggle the bottom + right panels
// (session only). Buttons opt out of the drag region so they stay clickable.
function Titlebar() {
  const s = useShell()
  return (
    <div className="titlebar" onDoubleClick={() => window.hearth.win.zoomToggle()}>
      {s.onboarded && (
        <>
          <div className="tb-left">
            <PanelBtn
              side="left"
              on={!s.railHidden}
              title={s.railHidden ? 'Show sidebar' : 'Hide sidebar'}
              onClick={s.toggleRailHidden}
            />
          </div>
          <div className="tb-right">
            <PanelBtn side="bottom" on={s.bottomOpen} title="Toggle bottom panel" onClick={() => s.setBottomOpen(!s.bottomOpen)} />
            <PanelBtn side="right" on={s.rightOpen} title="Toggle right panel" onClick={() => s.setRightOpen(!s.rightOpen)} />
          </div>
        </>
      )}
    </div>
  )
}
