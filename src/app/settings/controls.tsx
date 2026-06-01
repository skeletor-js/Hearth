import type { ReactNode } from 'react'

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="mini-seg">
      {options.map(([v, l]) => (
        <span key={v} className={'seg' + (value === v ? ' is-active' : '')} onClick={() => onChange(v)}>
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
