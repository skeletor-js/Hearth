import { useState, type ReactNode } from 'react'
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

/** Compact button used across the new settings sections. */
export function Btn({
  children,
  onClick,
  variant = 'default',
  disabled,
  busy,
  icon,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'accent' | 'danger' | 'ghost'
  disabled?: boolean
  busy?: boolean
  icon?: string
  title?: string
}) {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled || busy} title={title}>
      {busy ? <span className="btn-spin" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/** A status dot + label (reused for auth, MCP, skills rows). */
export function Status({ tone, children }: { tone: 'ok' | 'warn' | 'off' | 'run'; children: ReactNode }) {
  return (
    <span className="status">
      <span className={`dot ${tone}`} /> {children}
    </span>
  )
}

/** A row in a settings list (MCP servers, skills, secrets). Title + meta on the
 * left, action buttons on the right. */
export function ListRow({
  title,
  meta,
  trailing,
  actions,
}: {
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="list-row">
      <div className="list-main">
        <div className="list-title">{title}</div>
        {meta && <div className="list-meta">{meta}</div>}
      </div>
      {trailing && <div className="list-trailing">{trailing}</div>}
      {actions && <div className="list-actions">{actions}</div>}
    </div>
  )
}

/** A masked secret input with a save action. Never shows an existing value (the
 * renderer can't read secrets back) — `present` just renders a "set" affordance. */
export function SecretField({
  present,
  placeholder,
  onSave,
  onClear,
  saving,
}: {
  present: boolean
  placeholder: string
  onSave: (value: string) => void
  onClear?: () => void
  saving?: boolean
}) {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)

  if (present && !editing) {
    return (
      <div className="set-ctl">
        <span className="chip">
          <span className="dot ok" /> Set
        </span>
        <Btn variant="ghost" onClick={() => setEditing(true)}>
          Replace
        </Btn>
        {onClear && (
          <Btn variant="danger" onClick={onClear}>
            Clear
          </Btn>
        )}
      </div>
    )
  }
  return (
    <div className="secret-field">
      <input
        className="field"
        type="password"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSave(value.trim())
            setValue('')
            setEditing(false)
          }
        }}
      />
      <Btn
        variant="accent"
        busy={saving}
        disabled={!value.trim()}
        onClick={() => {
          onSave(value.trim())
          setValue('')
          setEditing(false)
        }}
      >
        Save
      </Btn>
      {present && (
        <Btn variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Btn>
      )}
    </div>
  )
}

/** A read-only command the user copies and runs themselves (login flows). */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-cmd"
      onClick={() => {
        void navigator.clipboard.writeText(command)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      title="Copy"
    >
      <code>{command}</code>
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}
