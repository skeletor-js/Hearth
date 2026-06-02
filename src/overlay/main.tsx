import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MorphTransition } from './MorphTransition'

// Entry for the transparent overlay window (see electron/main/windows/overlay-window.ts).
// It only ever paints the morph cover; the rest of the time it's an invisible,
// click-through window floating above the main window.

createRoot(document.getElementById('overlay-root')!).render(
  <StrictMode>
    <MorphTransition />
  </StrictMode>,
)

// Tell main the overlay renderer is live and can receive cover/handoff frames.
window.hearth?.morph?.signal('ready')
