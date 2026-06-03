// Transparent overlay window for the morph cover (B1 of SEAMLESS-SELF-MOD-PLAN).
//
// A frameless, transparent, always-on-top window that spans every display and
// floats above the main window. It is invisible and click-through while idle; the
// morph controller (B4) shows it, hands it a screenshot of the current UI, runs
// the reload behind it, then animates to the new UI — so a structural self-mod
// reload never shows a black flash. This module owns only the window lifecycle.

import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { HEARTH_CHANNELS } from '../../shared/channels.js'
import type { RendererTarget } from '../dev-server.js'

export type MorphSignal = 'ready' | 'cover-painted' | 'done'
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Union bounds of all displays, so one window covers the whole desktop.
function allDisplaysBounds(): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of screen.getAllDisplays()) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// Where the overlay renderer (overlay.html) loads from — mirrors how the main
// window loads index.html. Dev/packaged-Vite serve over a URL; the static
// fallback loads the built file next to the main bundle.
function overlaySource(target: RendererTarget): { url?: string; file?: string } {
  if (target.url) return { url: new URL('overlay.html', target.url).toString() }
  return { file: join(__dirname, '../renderer/overlay.html') }
}

export class OverlayWindow {
  private win: BrowserWindow | null = null
  private ready = false
  private readyWaiters: Array<() => void> = []
  // Resolvers waiting on a specific overlay→main signal (cover-painted / done).
  private signalWaiters = new Map<MorphSignal, Array<() => void>>()
  private signalListenerBound = false

  constructor(private readonly target: RendererTarget) {}

  // Listen for overlay→main morph signals, filtered to THIS window's webContents.
  private bindSignalListener(): void {
    if (this.signalListenerBound) return
    this.signalListenerBound = true
    ipcMain.on(HEARTH_CHANNELS.morphSignal, (event, payload: { type?: MorphSignal }) => {
      if (!this.win || this.win.isDestroyed()) return
      if (event.sender !== this.win.webContents) return
      const type = payload?.type
      if (!type) return
      const waiters = this.signalWaiters.get(type)
      if (waiters) {
        this.signalWaiters.set(type, [])
        for (const w of waiters) w()
      }
    })
  }

  /** The overlay's top-left in global screen coords (union of all displays). */
  originOffset(): { x: number; y: number } {
    const b = allDisplaysBounds()
    return { x: b.x, y: b.y }
  }

  /** Push a screenshot to the overlay to paint as the cover, positioned at `rect`
   *  (overlay-local px) so it sits exactly where the window is — a seamless freeze,
   *  not a fullscreen stretch. */
  sendCover(oldFrame: string, rect: Rect): void {
    this.ensure().webContents.send(HEARTH_CHANNELS.morphCover, { oldFrame, rect })
  }

  /** Hand the overlay the post-reload screenshot to morph to. */
  sendHandoff(newFrame: string): void {
    this.ensure().webContents.send(HEARTH_CHANNELS.morphHandoff, { newFrame })
  }

  /** Resolve when the overlay reports `type` (or after timeoutMs, so we never hang). */
  awaitSignal(type: MorphSignal, timeoutMs: number): Promise<void> {
    this.bindSignalListener()
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs)
      const done = () => {
        clearTimeout(t)
        resolve()
      }
      const list = this.signalWaiters.get(type) ?? []
      list.push(done)
      this.signalWaiters.set(type, list)
    })
  }

  /** Create the window (idempotent) and begin loading the overlay renderer. */
  ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const bounds = allDisplaysBounds()
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false, // never steal focus from the app
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true) // click-through while idle
    win.once('ready-to-show', () => {
      this.ready = true
      for (const w of this.readyWaiters.splice(0)) w()
    })
    const src = overlaySource(this.target)
    if (src.url) void win.loadURL(src.url)
    else if (src.file) void win.loadFile(src.file)

    // Keep covering the whole desktop if displays change while it's alive.
    const respan = () => {
      if (this.win && !this.win.isDestroyed()) this.win.setBounds(allDisplaysBounds())
    }
    screen.on('display-added', respan)
    screen.on('display-removed', respan)
    screen.on('display-metrics-changed', respan)
    win.on('closed', () => {
      screen.off('display-added', respan)
      screen.off('display-removed', respan)
      screen.off('display-metrics-changed', respan)
      this.win = null
      this.ready = false
    })

    this.win = win
    return win
  }

  /** Resolve once the overlay renderer has painted its first frame. */
  whenReady(timeoutMs = 1500): Promise<void> {
    this.ensure()
    if (this.ready) return Promise.resolve()
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs)
      this.readyWaiters.push(() => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  /** Bring the cover on screen, capturing input (so clicks don't hit the app mid-morph). */
  show(): void {
    const win = this.ensure()
    win.setBounds(allDisplaysBounds())
    win.setIgnoreMouseEvents(false)
    win.showInactive() // visible without stealing focus
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  /** Hide the cover and return to click-through idle. */
  hide(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.hide()
    this.win.setIgnoreMouseEvents(true)
  }

  webContents() {
    return this.ensure().webContents
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.ready = false
  }
}
