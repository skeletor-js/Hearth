import { useEffect, useState } from 'react'
import { RELOAD_TIER } from '@/shared/contracts/morph-timing'

// The morph cover surface. Lifecycle, driven by main over IPC (B2):
//   1. morph:cover  → paint the OLD frame full-bleed, then signal 'cover-painted'
//      (main reloads the app behind this cover).
//   2. morph:handoff → crossfade OLD → NEW frame, then signal 'done' and go idle.
// Idle = renders nothing, so the overlay window is fully transparent.
//
// A full-bleed div with pointer-events captures input during the transition so
// stray clicks/scrolls don't hit the app mid-reload (the overlay window also
// captures the mouse at the OS level while shown — this is belt-and-suspenders).

interface Rect {
  x: number
  y: number
  width: number
  height: number
}
type Phase =
  | { kind: 'idle' }
  | { kind: 'cover'; old: string; rect: Rect }
  | { kind: 'morph'; old: string; next: string; rect: Rect }

// Position the frame exactly where the window is (overlay-local px), so the cover
// is a seamless freeze of the window — not a fullscreen stretch.
function frameStyle(rect: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    objectFit: 'fill',
  }
}

export function MorphTransition() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [fadeNew, setFadeNew] = useState(false)
  const t = RELOAD_TIER

  useEffect(() => {
    const offCover = window.hearth?.morph?.onCover((oldFrame, rect) => {
      setFadeNew(false)
      setPhase({ kind: 'cover', old: oldFrame, rect })
    })
    const offHandoff = window.hearth?.morph?.onHandoff((newFrame) => {
      setPhase((p) =>
        p.kind === 'idle'
          ? p // no cover yet — ignore stray handoff
          : { kind: 'morph', old: p.old, next: newFrame, rect: p.rect },
      )
    })
    return () => {
      offCover?.()
      offHandoff?.()
    }
  }, [])

  // Once the cover has painted, tell main it's safe to reload behind it.
  const coverFrame = phase.kind === 'cover' ? phase.old : null
  useEffect(() => {
    if (!coverFrame) return
    // Two RAFs ≈ after the browser has actually painted the cover image.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => window.hearth?.morph?.signal('cover-painted'))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [coverFrame])

  // Crossfade to the new frame, then signal done + go idle.
  const morphNext = phase.kind === 'morph' ? phase.next : null
  useEffect(() => {
    if (!morphNext) return
    const start = requestAnimationFrame(() => setFadeNew(true))
    const done = setTimeout(() => {
      window.hearth?.morph?.signal('done')
      setPhase({ kind: 'idle' })
      setFadeNew(false)
    }, t.handoffFadeMs + 60)
    return () => {
      cancelAnimationFrame(start)
      clearTimeout(done)
    }
  }, [morphNext, t.handoffFadeMs])

  if (phase.kind === 'idle') return null

  const rect = phase.rect
  const oldSrc = phase.old
  const newSrc = phase.kind === 'morph' ? phase.next : null
  const base = frameStyle(rect)

  // Transparent backdrop (so only the window-rect frame shows — outside stays the
  // real desktop); pointer-events auto absorbs stray input during the transition.
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', background: 'transparent' }}>
      <img src={oldSrc} alt="" style={{ ...base, opacity: 1 }} />
      {newSrc && (
        <img
          src={newSrc}
          alt=""
          style={{ ...base, opacity: fadeNew ? 1 : 0, transition: `opacity ${t.handoffFadeMs}ms ease` }}
        />
      )}
    </div>
  )
}
