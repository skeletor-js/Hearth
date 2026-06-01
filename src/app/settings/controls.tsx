import type { ReactNode } from 'react'
import { Icon } from '@/shell/Icon'

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  // [value, label] or [value, label, iconName] — icon is optional.
  options: [T, string, string?][]
  onChange: (v: T) => void
}) {
  return (
    <div className="mini-seg">
      {options.map(([v, l, icon]) => (
        <span key={v} className={'seg' + (value === v ? ' is-active' : '')} onClick={() => onChange(v)}>
          {icon && <Icon name={icon} />}
          {l}
        </span>
      ))}
    </div>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={'sw' + (on ? ' on' : '')} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <i />
    </button>
  )
}

export function SetRow({ k, h, children }: { k: string; h?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-k">{k}</div>
        {h && <div className="set-h">{h}</div>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

/** Section label that owns its top spacing — keeps every section evenly spaced
 * (including the first), replacing ad-hoc empty `<div className="sec">` wrappers. */
export function SecLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="sec">
      <div className="sec-label">
        <Icon name={icon} /> {children}
      </div>
    </div>
  )
}
