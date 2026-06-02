import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import { ReviewTab } from './ReviewTab'
import { PlanTab } from './PlanTab'
import { SelfTab } from './SelfTab'
import { ScratchpadTab } from './ScratchpadTab'
import { FilesTab } from './FilesTab'
import { TerminalTab } from './TerminalTab'
import { BrowserTab } from './BrowserTab'
import { AgentsTab } from './AgentsTab'

// Always-available tools come first (stable, never hidden); session-contextual
// tabs follow and only appear when they actually have something to show, so they
// don't slot in front of the tools and shift them around.
const WB_TABS = [
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'scratchpad', icon: 'note-pencil', label: 'Scratchpad' },
  { id: 'terminal', icon: 'terminal-window', label: 'Terminal' },
  { id: 'browser', icon: 'globe', label: 'Browser' },
  { id: 'review', icon: 'git-diff', label: 'Review' },
  { id: 'self', icon: 'flame', label: 'Self', flame: true },
  { id: 'agents', icon: 'users-three', label: 'Agents' },
  { id: 'plan', icon: 'list-checks', label: 'Plan' },
] as const

// The four tools are always shown; the rest are contextual (see `needed`).
const ALWAYS_TABS = new Set(['files', 'scratchpad', 'terminal', 'browser'])

function TabBody({ tab, onOpenTab }: { tab: string; onOpenTab: (id: string) => void }) {
  switch (tab) {
    case 'self':
      return <SelfTab />
    case 'agents':
      return <AgentsTab />
    case 'scratchpad':
      return <ScratchpadTab />
    case 'files':
      return <FilesTab />
    case 'terminal':
      return <TerminalTab />
    case 'browser':
      return <BrowserTab />
    case 'plan':
      return <PlanTab />
    default:
      return <ReviewTab onOpenTab={onOpenTab} />
  }
}

// One panel used for BOTH the right and bottom panels; each owns its active tab.
// Off-session (no chat) only the always-tools show — review/plan/self/agents are
// session-contextual and have nothing to show without a session.
export function WorkPanel({
  orientation,
  tab,
  setTab,
  offSession = false,
}: {
  orientation: 'right' | 'bottom'
  tab: string
  setTab: (id: string) => void
  offSession?: boolean
}) {
  const reviewCount = useSession((s) => s.reviewCount)
  const planCount = useSession((s) => s.plan.length)
  const lastSelfEdit = useSession((s) => s.lastSelfEdit)
  const [agentsActive, setAgentsActive] = useState(false)
  useEffect(() => window.hearth.selfMod.onActivity((a) => setAgentsActive(a.lanes.length > 0)), [])

  const badgeFor = (id: string): number => (id === 'review' ? reviewCount : id === 'plan' ? planCount : 0)

  // Contextual tabs appear only when they have something to show this session.
  const needed = (id: string): boolean => {
    switch (id) {
      case 'review':
        return reviewCount > 0
      case 'plan':
        return planCount > 0
      case 'self':
        return lastSelfEdit != null
      case 'agents':
        return agentsActive
      default:
        return true
    }
  }
  const tabs = WB_TABS.filter((t) => ALWAYS_TABS.has(t.id) || (!offSession && needed(t.id)))

  // If the active tab fell out of view (a contextual tab that's no longer needed),
  // fall back to a sensible always-tool.
  const fallback = orientation === 'bottom' ? 'terminal' : 'files'
  const tabVisible = tabs.some((t) => t.id === tab)
  useEffect(() => {
    if (!tabVisible) setTab(fallback)
  }, [tabVisible, fallback, setTab])

  return (
    <div className="wp" data-screen-label={orientation === 'bottom' ? 'Bottom panel' : 'Right panel'}>
      <div className="wb-tabbar">
        <div className="wb-tabs">
          {tabs.map((t) => {
            const badge = badgeFor(t.id)
            return (
              <div key={t.id} className={'wb-tab' + (tab === t.id ? ' is-active' : '')} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} fill={'flame' in t && t.flame && tab === t.id} />
                {t.label}
                {badge > 0 && tab !== t.id && <span className="wb-badge">{badge}</span>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="wb-body scroll">
        <TabBody tab={tab} onOpenTab={setTab} />
      </div>
    </div>
  )
}
