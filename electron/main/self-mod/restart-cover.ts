// B7 — restart coverage across boot (packaged builds only).
//
// A main/preload self-mod needs a full process restart (app.relaunch), which kills
// the renderer AND the morph overlay — so the in-process morph can't cover it. The
// trick Stella uses: before relaunching, screenshot the current UI to disk; on the
// next boot, show that screenshot as the overlay cover immediately, then morph to
// the new UI once it paints. The user sees old UI → transition → new UI across a
// process restart, never a black launch.
//
// Inert in dev: electron-vite owns the dev restart lifecycle, so `armRestartCover`
// is only called from the PACKAGED relaunch branch. With no armed frame on disk,
// `consumeRestartCover` returns null and boot proceeds normally — this module
// cannot affect a dev boot.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { captureFrame } from '../windows/morph-capture.js'
import type { Rect } from '../windows/overlay-window.js'

const FILE = 'restart-cover.json'
// Only honor a frame written just before this boot — a stale one must never cover
// (and thus hide) a normal or broken launch.
const FRESH_MS = 15_000

interface StoredCover {
  frame: string
  bounds: { x: number; y: number; width: number; height: number }
  ts: number
}

/** Screenshot the window to disk just before a packaged relaunch. Best-effort. */
export async function armRestartCover(win: BrowserWindow, userDataDir: string, now: number): Promise<void> {
  try {
    const frame = await captureFrame(win)
    const data: StoredCover = { frame, bounds: win.getBounds(), ts: now }
    writeFileSync(join(userDataDir, FILE), JSON.stringify(data), { mode: 0o600 })
  } catch {
    // best-effort — a failed capture just means no cover on the next boot
  }
}

/**
 * On boot, consume an armed restart frame if it's fresh. Returns the frame + its
 * rect in overlay-local coords, or null (no armed frame / stale / unreadable). The
 * file is always deleted so it's used at most once.
 */
export function consumeRestartCover(
  userDataDir: string,
  overlayOrigin: { x: number; y: number },
  now: number,
): { frame: string; rect: Rect } | null {
  const path = join(userDataDir, FILE)
  if (!existsSync(path)) return null
  let data: StoredCover | null = null
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as StoredCover
  } catch {
    data = null
  }
  rmSync(path, { force: true }) // consume once, no matter what
  if (!data?.frame || typeof data.ts !== 'number' || now - data.ts > FRESH_MS) return null
  const b = data.bounds
  return {
    frame: data.frame,
    rect: { x: b.x - overlayOrigin.x, y: b.y - overlayOrigin.y, width: b.width, height: b.height },
  }
}
