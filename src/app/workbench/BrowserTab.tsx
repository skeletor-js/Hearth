import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'
import type { BrowserState } from '../../../electron/main/browser/browser-view'

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false }

export function BrowserTab() {
  const active = useSession((s) => s.active)
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  // Mirror `editing` into a ref so the onState subscription — registered once per
  // workspace and closed over the first render — reads the LIVE value instead of a
  // stale `false`, which otherwise overwrites the URL bar while the user is typing.
  const editingRef = useRef(false)
  const setEditingBoth = (v: boolean) => {
    editingRef.current = v
    setEditing(v)
  }
  const regionRef = useRef<HTMLDivElement>(null)

  // The WebContentsView floats above the renderer; keep its bounds glued to the
  // content region through resizes, layout shifts, and panel moves.
  useEffect(() => {
    const region = regionRef.current
    if (!region) return
    const sync = () => {
      const r = region.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) window.hearth.browser.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    const defaultUrl = active?.self ? window.location.origin : 'about:blank'
    window.hearth.browser.open(active?.workspaceId, defaultUrl)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(region)
    window.addEventListener('resize', sync)
    // Catch position changes that don't resize the region (rail collapse, etc.).
    const tick = setInterval(sync, 300)
    const off = window.hearth.browser.onState((s) => {
      setState(s)
      if (!editingRef.current) setDraft(s.url)
    })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      clearInterval(tick)
      off()
      window.hearth.browser.hide()
    }
  }, [active?.workspaceId])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    window.hearth.browser.navigate(draft, active?.workspaceId)
    setEditingBoth(false)
  }

  return (
    <div className="bview">
      <div className="bview-url">
        <button className="btn-icon" disabled={!state.canGoBack} title="Back" onClick={() => window.hearth.browser.back()}>
          <Icon name="arrow-left" />
        </button>
        <button className="btn-icon" disabled={!state.canGoForward} title="Forward" onClick={() => window.hearth.browser.forward()}>
          <Icon name="arrow-right" />
        </button>
        <button className="btn-icon" title="Reload" onClick={() => window.hearth.browser.reload()}>
          <Icon name={state.loading ? 'x' : 'arrow-clockwise'} />
        </button>
        <form className="bar" onSubmit={submit} style={{ flex: 1 }}>
          <Icon name={state.url.startsWith('https') ? 'lock-simple' : 'globe'} fill={state.url.startsWith('https')} />
          <input
            value={editing ? draft : state.url || draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setEditingBoth(true)
              setDraft(state.url)
              e.target.select()
            }}
            onBlur={() => setEditingBoth(false)}
            placeholder="Search or enter a URL"
            spellCheck={false}
          />
        </form>
        <button
          className="btn-icon"
          title="Open in your default browser"
          onClick={() => state.url && state.url !== 'about:blank' && window.open(state.url, '_blank')}
        >
          <Icon name="arrow-square-out" />
        </button>
        <span
          className="chip chip-sm"
          title="The agent shares this exact browser session — anything you sign into here is visible to it."
        >
          <Icon name="users-three" /> shared
        </span>
      </div>
      {/* The native browser view is painted over this region by main. */}
      <div ref={regionRef} className="bview-canvas" style={{ background: 'var(--bg-inset)' }} />
    </div>
  )
}
