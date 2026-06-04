import { useEffect, useRef, useState } from 'react'
import type { BrowserCursorEvent } from '../../electron/shared/protocol'

// The agent's ghost cursor for the embedded browser (P6). Main maps the agent's
// spatial actions (click/fill/nav) into overlay-local px and pushes them here; we
// glide a cursor to the point and ripple on action, so you watch the agent act on
// the same page you're looking at. Renders in the transparent, click-through overlay
// window that floats above the native browser view. See docs/PRESENCE.md.

const EMBER = '#C8542B'
const LABEL: Record<BrowserCursorEvent['kind'], string> = { click: 'click', fill: 'type', nav: 'go' }

interface CursorState extends BrowserCursorEvent {
  nonce: number
}

export function BrowserCursor() {
  const [c, setC] = useState<CursorState | null>(null)
  const [fading, setFading] = useState(false)
  const nonce = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return window.hearth?.cursor?.onBrowser((e) => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
      setFading(false)
      setC({ ...e, nonce: nonce.current++ })
      // Hold, then fade, then clear — so a burst of actions keeps the cursor alive.
      timers.current.push(setTimeout(() => setFading(true), 1500))
      timers.current.push(setTimeout(() => setC(null), 1950))
    })
  }, [])

  if (!c) return null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: fading ? 0 : 1, transition: 'opacity .4s ease' }}>
      <style>{`@keyframes hearth-ripple{ from{ transform:translate(-50%,-50%) scale(.2); opacity:.7 } to{ transform:translate(-50%,-50%) scale(1); opacity:0 } }`}</style>
      {/* Ripple — keyed by nonce so each action replays the animation. */}
      <div
        key={c.nonce}
        style={{
          position: 'absolute',
          left: c.x,
          top: c.y,
          width: 46,
          height: 46,
          marginLeft: -23,
          marginTop: -23,
          borderRadius: '50%',
          border: `2px solid ${EMBER}`,
          animation: 'hearth-ripple .6s ease-out forwards',
        }}
      />
      {/* The cursor arrow — glides to the point. Tip sits at (x, y). */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        style={{ position: 'absolute', left: c.x, top: c.y, transition: 'left .25s ease-out, top .25s ease-out', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}
      >
        <path d="M2 2 L2 16 L6 12 L9 19 L12 18 L9 11 L15 11 Z" fill={EMBER} stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      {/* Action label beside the cursor. */}
      <div
        style={{
          position: 'absolute',
          left: c.x + 18,
          top: c.y + 6,
          transition: 'left .25s ease-out, top .25s ease-out',
          background: EMBER,
          color: '#fff',
          fontSize: 11,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontWeight: 600,
          padding: '2px 7px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
        }}
      >
        {LABEL[c.kind]}
      </div>
    </div>
  )
}
