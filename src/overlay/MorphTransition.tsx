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

type Phase =
  | { kind: 'idle' }
  | { kind: 'cover'; old: string }
  | { kind: 'morph'; old: string; next: string }

const FRAME: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
}

export function MorphTransition() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [fadeNew, setFadeNew] = useState(false)
  const t = RELOAD_TIER

  useEffect(() => {
    const offCover = window.hearth?.morph?.onCover((oldFrame) => {
      setFadeNew(false)
      setPhase({ kind: 'cover', old: oldFrame })
    })
    const offHandoff = window.hearth?.morph?.onHandoff((newFrame) => {
      setPhase((p) => (p.kind === 'cover' ? { kind: 'morph', old: p.old, next: newFrame } : { kind: 'morph', old: newFrame, next: newFrame }))
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

  const oldSrc = phase.old
  const newSrc = phase.kind === 'morph' ? phase.next : null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', background: '#0b0b0e' }}>
      <img src={oldSrc} alt="" style={{ ...FRAME, opacity: 1 }} />
      {newSrc && (
        <img
          src={newSrc}
          alt=""
          style={{ ...FRAME, opacity: fadeNew ? 1 : 0, transition: `opacity ${t.handoffFadeMs}ms ease` }}
        />
      )}
    </div>
  )
}
