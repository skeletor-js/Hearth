// The agent's bridge to the LIVE app: it can both see it and drive it.
//
// The renderer only renders/behaves correctly inside Electron (it needs the
// preload's window.hearth), so the only process that can capture or script it is
// main. We expose a tiny loopback HTTP server (base URL written to
// .hearth/bridge-url) with:
//
//   GET  /snapshot[?path=/route]  -> PNG of the live window (or a route, captured
//                                    in a hidden window so the user's view is
//                                    untouched).
//   POST /eval   {code}           -> runs JS in the live renderer via
//                                    webContents.executeJavaScript and returns the
//                                    (JSON-serializable) result. This is how the
//                                    agent clicks/fills/reads/navigates — anything
//                                    the user could, including window.hearth IPC.
//
// Both the `view-app` script and the Hearth MCP server (agent-tools/
// hearth-mcp-server.mjs) hit this. Every MCP call is permission-gated by the
// adapter, so the user stays in the loop.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { HEARTH_CHANNELS } from '../shared/channels.js'
import type { BrowserManager } from './browser/browser-view.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body) ?? 'null'
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

export interface AgentBridgeDeps {
  /** The user's window — captured/scripted as-is (the live app). */
  mainWindow: BrowserWindow
  /** Lazily create a hidden window for off-screen route captures. */
  createSnapshotWindow: () => BrowserWindow
  /** The embedded browser the agent can drive (same view the user logs into). */
  browser: BrowserManager
}

// JS run inside the embedded browser page for read. Click/fill live on BrowserManager
// (they also report where the action landed, to drive the presence cursor — see P6).
const READ_JS = `({ url: location.href, title: document.title, text: (document.body && document.body.innerText || '').slice(0, 20000) })`

export function startAgentBridge(deps: AgentBridgeDeps, repoRoot: string): () => void {
  // Per-boot bearer token. The bridge runs arbitrary JS in the renderer, so
  // loopback alone is not an auth boundary — any local process could otherwise
  // read the port and drive the app. The token is written to .hearth/bridge-token
  // (0600) and required on every request; only processes that can read the file
  // (our MCP child + the view-app script) can reach the bridge.
  const token = randomBytes(32).toString('hex')

  // One reusable hidden window for route captures, created on first use.
  let offscreen: BrowserWindow | null = null
  const ensureOffscreen = async (): Promise<BrowserWindow> => {
    if (offscreen && !offscreen.isDestroyed()) return offscreen
    offscreen = deps.createSnapshotWindow()
    await new Promise<void>((resolve) => offscreen!.webContents.once('did-finish-load', () => resolve()))
    return offscreen
  }

  const capturePng = async (target: BrowserWindow, path: string | null): Promise<Buffer> => {
    if (path) {
      target.webContents.send(HEARTH_CHANNELS.viewNavigate, { path })
      await sleep(500) // let the route render + paint (memory history, not URL-driven)
    }
    return (await target.webContents.capturePage()).toPNG()
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.headers['x-hearth-token'] !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthorized')
      return
    }
    try {
      if (req.method === 'GET' && url.pathname === '/snapshot') {
        const path = url.searchParams.get('path')
        // Route capture -> hidden window (don't disturb the user's view). No path
        // -> the user's current window, live state and all.
        const target = path ? await ensureOffscreen() : deps.mainWindow
        const png = await capturePng(target, path)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
        res.end(png)
        return
      }
      if (req.method === 'POST' && url.pathname === '/eval') {
        const { code } = JSON.parse(await readBody(req)) as { code?: string }
        if (typeof code !== 'string') {
          sendJson(res, 400, { ok: false, error: 'expected { code: string }' })
          return
        }
        // Runs in the live renderer's page context — DOM + window.hearth.
        const result = await deps.mainWindow.webContents.executeJavaScript(code, true)
        sendJson(res, 200, { ok: true, result })
        return
      }
      // ── Embedded-browser control (same view the user logs into) ──────────
      if (url.pathname.startsWith('/browser/')) {
        const action = url.pathname.slice('/browser/'.length)
        const wc = deps.browser.contents()
        if (req.method === 'GET' && action === 'screenshot') {
          const png = (await wc.capturePage()).toPNG()
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
          res.end(png)
          return
        }
        const body = req.method === 'POST' ? (JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>) : {}
        if (action === 'navigate') {
          deps.browser.navigate(String(body.url ?? ''))
          deps.browser.signalNav()
          await sleep(300)
          sendJson(res, 200, { ok: true })
          return
        }
        if (action === 'back') { deps.browser.back(); sendJson(res, 200, { ok: true }); return }
        if (action === 'forward') { deps.browser.forward(); sendJson(res, 200, { ok: true }); return }
        if (action === 'reload') { deps.browser.reload(); sendJson(res, 200, { ok: true }); return }
        if (action === 'read') {
          const result = await wc.executeJavaScript(READ_JS, true)
          sendJson(res, 200, { ok: true, result })
          return
        }
        if (action === 'click') {
          sendJson(res, 200, await deps.browser.click(String(body.selector ?? '')))
          return
        }
        if (action === 'fill') {
          sendJson(res, 200, await deps.browser.fill(String(body.selector ?? ''), String(body.value ?? '')))
          return
        }
        if (action === 'eval') {
          const result = await wc.executeJavaScript(String(body.code ?? ''), true)
          sendJson(res, 200, { ok: true, result })
          return
        }
        sendJson(res, 404, { ok: false, error: `unknown browser action: ${action}` })
        return
      }

      res.writeHead(404)
      res.end('not found')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // /eval and /browser errors are returned as ok:false so the agent sees them.
      if (url.pathname === '/eval' || url.pathname.startsWith('/browser/')) sendJson(res, 200, { ok: false, error: message })
      else {
        res.writeHead(500)
        res.end(message)
      }
    }
  })

  // Loopback only — this is a local dev affordance, never exposed off-host.
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const dir = join(repoRoot, '.hearth')
    mkdirSync(dir, { recursive: true })
    const urlFile = join(dir, 'bridge-url')
    const tokenFile = join(dir, 'bridge-token')
    writeFileSync(urlFile, `http://127.0.0.1:${port}\n`)
    writeFileSync(tokenFile, `${token}\n`)
    // Restrict to the owner: the token is the only thing gating renderer RCE.
    try {
      chmodSync(urlFile, 0o600)
      chmodSync(tokenFile, 0o600)
    } catch {
      // chmod is best-effort (e.g. on filesystems that don't support it).
    }
  })

  return () => {
    server.close()
    if (offscreen && !offscreen.isDestroyed()) offscreen.destroy()
  }
}
