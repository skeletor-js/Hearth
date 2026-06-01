import type { CSSProperties } from 'react'

// Phosphor icon. Thin by default, fill when `fill`. Matches the handoff's `Icon`.
export function Icon({
  name,
  className = '',
  style,
  fill = false,
}: {
  name: string
  className?: string
  style?: CSSProperties
  fill?: boolean
}) {
  return <i className={`ph-${fill ? 'fill' : 'thin'} ph-${name} ${className}`} style={style} />
}

// Custom panel-toggle icons (rounded rect with a bar on one edge) — from the handoff.
const RAIL_ICON_PATHS: Record<'left' | 'right' | 'bottom', string> = {
  left: '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M6.55 6.45V11.55" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
  right:
    '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M11.45 6.45V11.55" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
  bottom:
    '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M6.25 11.35H11.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
}

export function RailIcon({ side, size = 18 }: { side: 'left' | 'right' | 'bottom'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      style={{ display: 'block' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: RAIL_ICON_PATHS[side] }}
    />
  )
}

export function PanelBtn({
  side,
  on,
  onClick,
  title,
  size,
}: {
  side: 'left' | 'right' | 'bottom'
  on?: boolean
  onClick?: () => void
  title?: string
  size?: number
}) {
  return (
    <button className={'pbtn' + (on ? ' on' : '')} title={title} onClick={onClick}>
      <RailIcon side={side} size={size} />
    </button>
  )
}
