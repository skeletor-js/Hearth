import { useEffect, useRef, useState } from 'react'
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
import { GitPanel } from './GitPanel'

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

// The "+" menu only offers the always-tools — contextual tabs surface on their own
// when relevant, so there's nothing to manually open.
const ADD_ITEMS = [
  ['files', 'folder', 'Files', 'Browse project files'],
  ['scratchpad', 'note-pencil', 'Scratchpad', 'Quick notes for the agent'],
  ['terminal', 'terminal-window', 'Terminal', 'Interactive shell'],
  ['browser', 'globe', 'Browser', 'Open a website'],
] as const

function AddTabMenu({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={{ right: 14, top: 46 }}>
        <div className="pop-sect">Open in this panel</div>
        {ADD_ITEMS.map(([id, icon, name, sub]) => (
          <div
            key={id}
            className="pop-item"
            onClick={() => {
              onPick(id)
              onClose()
            }}
          >
            <span className="pi-mark">
              <Icon name={icon} />
            </span>
            <div className="pi-body">
              <div className="pi-name">{name}</div>
              <div className="pi-sub">{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

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
export function WorkPanel({
  orientation,
  tab,
  setTab,
  onClose,
}: {
  orientation: 'right' | 'bottom'
  tab: string
  setTab: (id: string) => void
  onClose: () => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [gitAnchor, setGitAnchor] = useState<{ right: number; top: number } | null>(null)
  const gitBtn = useRef<HTMLButtonElement>(null)
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
  const tabs = WB_TABS.filter((t) => ALWAYS_TABS.has(t.id) || needed(t.id))

  // If the active tab fell out of view (a contextual tab that's no longer needed),
  // fall back to a sensible always-tool.
  const fallback = orientation === 'bottom' ? 'terminal' : 'files'
  const tabVisible = tabs.some((t) => t.id === tab)
  useEffect(() => {
    if (!tabVisible) setTab(fallback)
  }, [tabVisible, fallback, setTab])

  const openGit = () => {
    const r = gitBtn.current?.getBoundingClientRect()
    if (r) setGitAnchor({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 })
  }

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
        <div className="wb-actions">
          <button className="btn-icon" title="Open a tab" onClick={() => setAddOpen(true)}>
            <Icon name="plus" />
          </button>
          <button ref={gitBtn} className="btn-icon" title="Environment & git" onClick={openGit}>
            <Icon name="git-fork" />
          </button>
          <button className="btn-icon" title={orientation === 'bottom' ? 'Close bottom panel' : 'Close right panel'} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="wb-body scroll">
        <TabBody tab={tab} onOpenTab={setTab} />
      </div>
      {addOpen && <AddTabMenu onPick={setTab} onClose={() => setAddOpen(false)} />}
      {gitAnchor && <GitPanel anchor={gitAnchor} onClose={() => setGitAnchor(null)} />}
    </div>
  )
}
