import { useRef, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import { ReviewTab } from './ReviewTab'
import { PlanTab } from './PlanTab'
import { SelfTab } from './SelfTab'
import { FilesTab } from './FilesTab'
import { BrowserTab, TerminalTab } from './placeholders'
import { GitPanel } from './GitPanel'

const WB_TABS = [
  { id: 'review', icon: 'git-diff', label: 'Review' },
  { id: 'self', icon: 'flame', label: 'Self', flame: true },
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'terminal', icon: 'terminal-window', label: 'Terminal' },
  { id: 'browser', icon: 'globe', label: 'Browser' },
  { id: 'plan', icon: 'list-checks', label: 'Plan' },
] as const

const ADD_ITEMS = [
  ['review', 'git-diff', 'Review', 'Code changes'],
  ['files', 'folder', 'Files', 'Browse project files'],
  ['terminal', 'terminal-window', 'Terminal', 'Interactive shell'],
  ['browser', 'globe', 'Browser', 'Open a website'],
  ['plan', 'list-checks', 'Plan', 'Task checklist'],
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

  const badgeFor = (id: string): number => (id === 'review' ? reviewCount : id === 'plan' ? planCount : 0)

  const openGit = () => {
    const r = gitBtn.current?.getBoundingClientRect()
    if (r) setGitAnchor({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 })
  }

  return (
    <div className="wp" data-screen-label={orientation === 'bottom' ? 'Bottom panel' : 'Right panel'}>
      <div className="wb-tabbar">
        {WB_TABS.map((t) => {
          const badge = badgeFor(t.id)
          return (
            <div key={t.id} className={'wb-tab' + (tab === t.id ? ' is-active' : '')} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} fill={'flame' in t && t.flame && tab === t.id} />
              {t.label}
              {badge > 0 && tab !== t.id && <span className="wb-badge">{badge}</span>}
            </div>
          )
        })}
        <span className="spacer" />
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
