// Lets the agent SEE its own work. The renderer only renders correctly inside
// Electron (it needs window.hearth from the preload), so a plain headless browser
// hitting the dev URL would just show the error boundary. The only process with
// the real rendered frame is the main process, via webContents.capturePage().
//
// We expose that as a tiny loopback HTTP endpoint and write its URL to
// .hearth/snapshot-url. The `view-app` script (which the agent runs in its shell)
// fetches a PNG of the live, hot-reloaded window. See scripts/view-app.mjs and the
// "Visually verifying UI changes" section in CLAUDE.md / AGENTS.md.

import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export function startSnapshotServer(window: BrowserWindow, repoRoot: string): () => void {
  const server: Server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/snapshot')) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    try {
      const image = await window.webContents.capturePage()
      const png = image.toPNG()
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

  return () => server.close()
}
