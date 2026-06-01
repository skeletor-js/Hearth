import { Link } from '@tanstack/react-router'
import { BackendSwitcher } from './BackendSwitcher'

// Registry of sidebar apps. The agent edits this list when it adds an app.
// (A later version can derive it from the routes dir so there's one source.)
const APPS = [
  { to: '/chat', label: 'Chat' },
  { to: '/history', label: 'History' },
] as const

const LINK_CLASS =
  'rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/5 [&.active]:bg-white/10 [&.active]:text-white'

export function Sidebar() {
  return (
    <nav className="flex w-56 flex-col gap-1 border-r border-white/8 bg-black/20 p-3 pt-10">
      <div className="px-2 pb-3 text-xs font-medium tracking-wide text-white/40">HEARTH</div>
      {APPS.map((app) => (
        <Link key={app.to} to={app.to} className={LINK_CLASS}>
          {app.label}
        </Link>
      ))}
      <div className="px-2 pb-2 pt-4 text-xs font-medium tracking-wide text-white/40">MICRO-APPS</div>
      <Link to="/micro/$name" params={{ name: 'demo' }} className={LINK_CLASS}>
        Demo
      </Link>
      <BackendSwitcher />
    </nav>
  )
}
