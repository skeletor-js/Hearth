// Morph controller (B4 of SEAMLESS-SELF-MOD-PLAN). Orchestrates the screenshot
// cover so a structural-self-mod reload never shows a black flash:
//
//   1. screenshot the current UI
//   2. show the overlay + hand it the screenshot; wait until it has painted
//   3. run applyBehindCover() — the actual reload — hidden behind the cover
//   4. wait for the new UI to settle, screenshot it
//   5. hand the overlay the new frame; it crossfades old → new
//   6. hide the overlay
//
// Every wait is bounded; any failure reveals immediately and still performs the
// reload (degrade to a plain reload — never worse than today, never hang).

import type { BrowserWindow } from 'electron'
import { captureFrame } from '../windows/morph-capture.js'
import type { OverlayWindow } from '../windows/overlay-window.js'

// Controller-side timing. Mirrors src/shared/contracts/morph-timing.ts (the
// renderer's copy drives the CSS fade); kept local so main has no src/ import.
export interface MorphTiming {
  /** Wait after triggering the reload before screenshotting the new UI. */
  settleDelayMs: number
  /** Renderer crossfade duration — how long to wait for 'done'. */
  handoffFadeMs: number
}
export const RELOAD_TIMING: MorphTiming = { settleDelayMs: 1100, handoffFadeMs: 420 }

export interface MorphDeps {
  overlay: OverlayWindow
  mainWindow: BrowserWindow
}

// Wait for the main window to finish (re)loading, bounded — so we screenshot the
// new UI, not a half-painted frame, without hanging if the load event never comes.
function waitForReload(win: BrowserWindow, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      win.webContents.off('did-finish-load', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    win.webContents.once('did-finish-load', finish)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `applyBehindCover` (the reload trigger) hidden behind the morph cover.
 * Resolves once the cover has been torn down. Best-effort: on any error it still
 * runs the reload and reveals, so a reload always happens and the app never hangs.
 */
export async function runMorph(
  deps: MorphDeps,
  applyBehindCover: () => void | Promise<void>,
  timing: MorphTiming = RELOAD_TIMING,
): Promise<void> {
  const { overlay, mainWindow } = deps
  let applied = false
  const apply = async () => {
    if (applied) return
    applied = true
    await applyBehindCover()
  }

  try {
    const oldFrame = await captureFrame(mainWindow)
    await overlay.whenReady(1500)
    overlay.show()
    overlay.sendCover(oldFrame)
    await overlay.awaitSignal('cover-painted', 1500)

    await apply() // reload behind the cover

    await waitForReload(mainWindow, timing.settleDelayMs + 2000)
    await delay(timing.settleDelayMs)
    const newFrame = await captureFrame(mainWindow)

    overlay.sendHandoff(newFrame)
    await overlay.awaitSignal('done', timing.handoffFadeMs + 1500)
  } catch {
    await apply().catch(() => {}) // ensure the reload still happens
  } finally {
    overlay.hide()
  }
}
