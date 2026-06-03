import { useState } from 'react'
import { Icon } from '@/shell/Icon'

/**
 * Convert a typed display name into a valid micro-app slug. Must satisfy NAME_RE
 * in electron/main/micro-apps/validate.ts (`^[a-z0-9][a-z0-9_-]{0,63}$`) so the
 * scaffold can't reject it. Returns '' when nothing valid remains.
 */
export function toToolSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // collapse disallowed runs to a single dash
    .replace(/^[^a-z0-9]+/, '') // first char must be a letter or digit
    .replace(/-+$/, '') // tidy a trailing dash
    .slice(0, 64)
}

/**
 * "Save as tool" — scaffold a micro-app from the current conversation. Presentational:
 * it collects a name and hands the slug to `onSave`; ChatView owns scaffold + build.
 */
export function SaveAsTool({ onSave }: { onSave: (slug: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')
  const slug = toToolSlug(val)

  const close = () => {
    setOpen(false)
    setVal('')
  }
  const submit = () => {
    if (!slug) return
    void onSave(slug)
    close()
  }

  if (!open) {
    return (
      <div className="save-tool-row">
        <button className="btn btn-sm btn-quiet" onClick={() => setOpen(true)} title="Turn this conversation into a reusable micro-app">
          <Icon name="squares-four" /> Save as tool
        </button>
      </div>
    )
  }

  return (
    <div className="save-tool-row open">
      <input
        className="field"
        autoFocus
        placeholder="Name this tool"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') close()
        }}
      />
      <span className="save-tool-slug">{slug ? `micro-apps/${slug}` : 'lowercase letters, numbers, - or _'}</span>
      <button className="btn btn-sm btn-quiet" onClick={close}>
        Cancel
      </button>
      <button className="btn btn-sm btn-primary" disabled={!slug} onClick={submit}>
        <Icon name="check" /> Create
      </button>
    </div>
  )
}
