import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { Sidebar } from '@/shell/Sidebar'

export const Route = createRootRoute({
  component: RootLayout,
})

// The shell: a sidebar of apps + the active app in the main pane. Codex-Desktop
// styling lives here and in src/shell — pure renderer, no constraint from main.
function RootLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

// Re-exported so sidebar apps can link without importing router internals.
export { Link }
