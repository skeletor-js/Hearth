import type { ReactNode } from 'react'

// The main card's top bar: breadcrumbs (children) on the left, actions on the right.
export function Topbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div className="crumbs" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
      {right && <div className="tb-actions">{right}</div>}
    </div>
  )
}
