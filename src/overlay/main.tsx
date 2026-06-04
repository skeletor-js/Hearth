import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MorphTransition } from './MorphTransition'
import { BrowserCursor } from './BrowserCursor'

// Entry for the transparent overlay window (see electron/main/windows/overlay-window.ts).
// It paints the morph cover during self-mod reloads and the agent's browser cursor
// (P6); the rest of the time it's an invisible, click-through window floating above
// the main window.

createRoot(document.getElementById('overlay-root')!).render(
  <StrictMode>
    <MorphTransition />
    <BrowserCursor />
  </StrictMode>,
)

// Tell main the overlay renderer is live and can receive cover/handoff frames.
window.hearth?.morph?.signal('ready')
