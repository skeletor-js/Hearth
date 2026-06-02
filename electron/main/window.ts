import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import type { RendererTarget } from './dev-server.js'

const WEB_PREFERENCES = {
  // electron-vite emits the preload as .mjs (package.json is "type":"module").
  // Electron 28+ loads ESM preloads by extension; pointing at .js loads nothing
  // and window.hearth ends up undefined.
  preload: join(__dirname, '../preload/index.mjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // preload needs Node to bridge; renderer stays isolated
  // Keep painting when backgrounded so snapshot captures (electron/main/snapshot.ts)
  // stay accurate even when the user is in another app while the agent works.
  backgroundThrottling: false,
}

function loadRenderer(win: BrowserWindow, target: RendererTarget): void {
  if (target.url) void win.loadURL(target.url)
  else if (target.file) void win.loadFile(target.file)
}

// The origin the shell is served from; top-frame navigation is confined to it.
function targetOrigin(target: RendererTarget): string | null {
  if (!target.url) return null // file:// load — handled by the file:// check below
  try {
    return new URL(target.url).origin
  } catch {
    return null
  }
}

// Lock down the top frame: a compromised renderer (or a self-mod gone wrong) must
// not be able to open OS windows or navigate the shell off its own origin. The
// in-app browser is a separate WebContentsView with its own (already-guarded)
// handlers — this only governs the main window's own webContents.
function applyNavigationGuards(wc: WebContents, target: RendererTarget): void {
  // Deny every window.open / target=_blank outright. We deliberately do NOT
  // forward to shell.openExternal: under the malicious-agent / compromised-renderer
  // threat model, auto-opening arbitrary URLs in the user's real browser is an
  // abuse vector (spam, phishing). Legitimate "open in browser" actions must go
  // through an explicit, vetted affordance, not a blanket window.open intercept.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const allowed = targetOrigin(target)
  wc.on('will-navigate', (event, url) => {
    let origin: string | null = null
    try {
      origin = new URL(url).origin
    } catch {
      // unparseable → block
    }
    const ok = allowed ? origin === allowed : url.startsWith('file://')
    if (!ok) event.preventDefault()
  })
}

export function createMainWindow(target: RendererTarget): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset', // macOS: traffic lights over our own chrome
    backgroundColor: '#0b0b0e',
    show: false,
    webPreferences: WEB_PREFERENCES,
  })

  win.once('ready-to-show', () => win.show())
  applyNavigationGuards(win.webContents, target)
  loadRenderer(win, target)
  return win
}

// A hidden window used only to capture route-specific snapshots for the agent.
// Keeping it separate means `view_app({path})` never navigates — or wipes the
// state of — the user's actual window (e.g. the live chat). See snapshot.ts.
export function createSnapshotWindow(target: RendererTarget): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: WEB_PREFERENCES,
  })
  applyNavigationGuards(win.webContents, target)
  loadRenderer(win, target)
  return win
}
