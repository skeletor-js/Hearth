import { join } from 'node:path'
import { BrowserWindow } from 'electron'
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
  loadRenderer(win, target)
  return win
}
