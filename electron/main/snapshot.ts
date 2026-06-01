// Lets the agent SEE its own work. The renderer only renders correctly inside
// Electron (it needs window.hearth from the preload), so a plain headless browser
// hitting the dev URL would just show the error boundary. The only process with
// the real rendered frame is the main process, via webContents.capturePage().
//
// Loopback HTTP endpoint, URL written to .hearth/snapshot-url:
//   GET /snapshot              -> PNG of the user's CURRENT window (live state).
//   GET /snapshot?path=/route  -> PNG of /route rendered in a HIDDEN window, so the
//                                 user's window (and e.g. the live chat) is never
//                                 disturbed.
// Both the `view-app` script and the `view_app` MCP tool hit this endpoint.

import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { HEARTH_CHANNELS } from '../shared/channels.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface SnapshotDeps {
  /** The user's window — captured as-is for the current view. */
  mainWindow: BrowserWindow
  /** Lazily create a hidden window for off-screen route captures. */
  createSnapshotWindow: () => BrowserWindow
}

export function startSnapshotServer(deps: SnapshotDeps, repoRoot: string): () => void {
  // One reusable hidden window for route captures, created on first use.
  let offscreen: BrowserWindow | null = null
  const ensureOffscreen = async (): Promise<BrowserWindow> => {
    if (offscreen && !offscreen.isDestroyed()) return offscreen
    offscreen = deps.createSnapshotWindow()
    await new Promise<void>((resolve) => offscreen!.webContents.once('did-finish-load', () => resolve()))
    return offscreen
  }

  const capture = async (target: BrowserWindow, path: string | null): Promise<Buffer> => {
    if (path) {
      target.webContents.send(HEARTH_CHANNELS.viewNavigate, { path })
      await sleep(500) // let the route render + paint (memory history, not URL-driven)
    }
    return (await target.webContents.capturePage()).toPNG()
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/snapshot') {
      res.writeHead(404)
      res.end('not found')
      return
    }
    try {
      const path = url.searchParams.get('path')
      // Route capture -> hidden window (never disturb the user's view). No path ->
      // the user's current window, live state and all.
      const target = path ? await ensureOffscreen() : deps.mainWindow
      const png = await capture(target, path)
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
      res.end(png)
    } catch (err) {
      res.writeHead(500)
      res.end(`capture failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // Loopback only — this is a local dev affordance, never exposed off-host.
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const dir = join(repoRoot, '.hearth')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'snapshot-url'), `http://127.0.0.1:${port}/snapshot\n`)
  })

  return () => {
    server.close()
    if (offscreen && !offscreen.isDestroyed()) offscreen.destroy()
  }
}
