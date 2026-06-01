import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { resolveRendererTarget } from './dev-server.js'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset', // macOS: traffic lights over our own chrome
    backgroundColor: '#0b0b0e',
    show: false,
    webPreferences: {
      // electron-vite emits the preload as .mjs (package.json is "type":"module").
      // Electron 28+ loads ESM preloads by extension; pointing at .js loads nothing
      // and window.hearth ends up undefined.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node to bridge; renderer stays isolated
      // Keep painting when backgrounded so the agent's snapshot capture
      // (electron/main/snapshot.ts) stays accurate even when the user is in
      // another app while the agent works.
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  const target = resolveRendererTarget()
  if (target.url) win.loadURL(target.url)
  else if (target.file) win.loadFile(target.file)

  return win
}
