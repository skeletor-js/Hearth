import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from './Icon'
import { useShell } from './store'
import { startSession } from '@/app/sessions'
import type { Workspace } from '../../electron/main/workspaces/registry'

interface Command {
  id: string
  label: string
  ic: string
  grp: string
  run: () => void | Promise<void>
}

/** Global ⌘K state + the toggle hook (mounted once in the shell root). */
export function useCommandPalette(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { toggleTheme, setAccent } = useShell()
  const [q, setQ] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [sel, setSel] = useState(0)

  useEffect(() => {
    void window.hearth.workspaces.list().then(setWorkspaces)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate({ to })
    const nav: Command[] = [
      { id: 'new', label: 'New session', ic: 'plus', grp: 'Go', run: go('/new') },
      { id: 'chat', label: 'Open session', ic: 'chat-circle', grp: 'Go', run: go('/chat') },
      { id: 'search', label: 'Search', ic: 'magnifying-glass', grp: 'Go', run: go('/search') },
      { id: 'history', label: 'History', ic: 'clock-counter-clockwise', grp: 'Go', run: go('/history') },
      { id: 'settings', label: 'Settings', ic: 'gear', grp: 'Go', run: go('/settings') },
    ]
    const actions: Command[] = [
      { id: 'theme', label: 'Toggle light / dark theme', ic: 'moon-stars', grp: 'Theme', run: toggleTheme },
      { id: 'accent-ember', label: 'Accent · Ember', ic: 'palette', grp: 'Theme', run: () => setAccent('#C8542B') },
      { id: 'accent-sage', label: 'Accent · Sage', ic: 'palette', grp: 'Theme', run: () => setAccent('#5E7A5C') },
    ]
    const ws: Command[] = workspaces.map((w) => ({
      id: 'ws-' + w.id,
      label: `New session · ${w.name}`,
      ic: w.isHearth ? 'flame' : 'folder',
      grp: 'Workspace',
      run: async () => {
        await startSession(w)
        void navigate({ to: '/chat' })
      },
    }))
    return [...nav, ...actions, ...ws]
  }, [navigate, toggleTheme, setAccent, workspaces])

  const hits = q.trim() ? commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : commands
  const run = (c: Command | undefined) => {
    if (!c) return
    void c.run()
    onClose()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      run(hits[sel])
    }
  }

  return (
    <div className="cmdk-mask" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="magnifying-glass" />
          <input
            autoFocus
            placeholder="Search Hearth — destinations, theme, workspaces…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list scroll">
          {hits.length === 0 && <div className="cmdk-empty">No matches for “{q}”</div>}
          {hits.map((c, i) => (
            <div key={c.id} className={'cmdk-row' + (i === sel ? ' is-first' : '')} onClick={() => run(c)} onMouseEnter={() => setSel(i)}>
              <Icon name={c.ic} />
              <span className="cl">{c.label}</span>
              <span className="cg">{c.grp}</span>
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
            <Icon name="flame" fill className="ico-12" /> ⌘K
          </span>
        </div>
      </div>
    </div>
  )
}
