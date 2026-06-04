// Auto-update for the packaged build. electron-updater pulls a `latest-mac.yml`
// feed from the generic provider configured in package.json `build.publish`
// (a public Cloudflare URL — no token ships in the app), downloads the new
// signed+notarized .zip in the background, and stages it. We never auto-apply:
// the renderer is notified and the user clicks "Restart to update", which calls
// quitAndInstall. macOS only applies an update whose build is signed with the
// same Developer ID and notarized — Squirrel.Mac verifies the signature.
//
// In dev (not packaged) electron-updater can't run, so this is an inert no-op
// that reports `unsupported` — the IPC and UI still work, they just say so.

import { app, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
// electron-updater is CommonJS; the dev main bundle is ESM, where a named import
// (`import { autoUpdater }`) throws at load ("Named export not found"). Default-import
// then destructure — correct in both the ESM dev build and the packaged CJS build.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { HEARTH_CHANNELS } from '../shared/channels.js'
import type { UpdateStatus } from '../shared/protocol.js'

// First check shortly after boot (let the app settle), then periodically while open.
const INITIAL_DELAY_MS = 8_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h

export interface Updater {
  /** Latest known status (for a renderer that subscribes late). */
  getStatus(): UpdateStatus
  /** Force a feed check now; resolves to the resulting status. */
  check(): Promise<UpdateStatus>
  /** Apply a staged update by restarting into it. */
  installNow(): { ok: boolean; error?: string }
  dispose(): void
}

export function setupAutoUpdater(window: BrowserWindow): Updater {
  let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unsupported' }
  const push = (next: UpdateStatus): void => {
    status = next
    if (!window.isDestroyed()) window.webContents.send(HEARTH_CHANNELS.updateStatus, status)
  }

  // Dev / unpacked: no updater. Keep the surface so the renderer behaves uniformly.
  if (!app.isPackaged) {
    return {
      getStatus: () => status,
      check: async () => status,
      installNow: () => ({ ok: false, error: 'Updates only apply in a packaged build.' }),
      dispose: () => {},
    }
  }

  autoUpdater.autoDownload = true // fetch in the background as soon as one is found
  autoUpdater.autoInstallOnAppQuit = false // never apply silently — the user chooses when

  autoUpdater.on('checking-for-update', () => push({ state: 'checking', version: status.version }))
  autoUpdater.on('update-available', (info) => push({ state: 'available', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => push({ state: 'idle' }))
  autoUpdater.on('download-progress', (p) =>
    push({ state: 'available', version: status.version, percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) => push({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => push({ state: 'error', error: err instanceof Error ? err.message : String(err) }))

  const check = async (): Promise<UpdateStatus> => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      push({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    return status
  }

  // Don't restart into an update while a self-mod restart is already armed — that
  // marker is consumed by the boot watchdog; racing it could lose the pending state.
  const pendingSelfMod = join(app.getPath('userData'), 'pending-self-mod-restart.json')
  const installNow = (): { ok: boolean; error?: string } => {
    if (status.state !== 'downloaded') return { ok: false, error: 'No update is staged yet.' }
    if (existsSync(pendingSelfMod)) {
      return { ok: false, error: 'A self-modification restart is in progress — try again in a moment.' }
    }
    // Defer so the IPC reply flushes before the app tears down.
    setImmediate(() => autoUpdater.quitAndInstall())
    return { ok: true }
  }

  const initial = setTimeout(() => void check(), INITIAL_DELAY_MS)
  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS)

  return {
    getStatus: () => status,
    check,
    installNow,
    dispose: () => {
      clearTimeout(initial)
      clearInterval(interval)
      autoUpdater.removeAllListeners()
    },
  }
}
