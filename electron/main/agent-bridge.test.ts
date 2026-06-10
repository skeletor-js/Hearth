import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAgentBridge, type AgentBridgeDeps } from './agent-bridge'

let stop: (() => void) | null = null
let dir: string | null = null

afterEach(() => {
  if (stop) stop()
  stop = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

// The deps are only dereferenced after the auth + route match, so a minimal stub
// is enough to exercise the 401/404 gate without an Electron window.
async function boot(): Promise<{ base: string; token: string }> {
  dir = mkdtempSync(join(tmpdir(), 'hearth-bridge-'))
  const deps = { mainWindow: {}, createSnapshotWindow: () => ({}), browser: {} } as unknown as AgentBridgeDeps
  stop = startAgentBridge(deps, dir)
  const urlFile = join(dir, '.hearth', 'bridge-url')
  const tokenFile = join(dir, '.hearth', 'bridge-token')
  for (let i = 0; i < 200 && !(existsSync(urlFile) && existsSync(tokenFile)); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  return { base: readFileSync(urlFile, 'utf8').trim(), token: readFileSync(tokenFile, 'utf8').trim() }
}

test('rejects a request with no token', async () => {
  const { base } = await boot()
  const res = await fetch(`${base}/eval`, { method: 'POST', body: JSON.stringify({ code: '1' }) })
  expect(res.status).toBe(401)
})

test('rejects a request with the wrong token', async () => {
  const { base } = await boot()
  const res = await fetch(`${base}/snapshot`, { headers: { 'x-hearth-token': 'nope' } })
  expect(res.status).toBe(401)
})

test('a valid token passes the auth gate (then routes normally)', async () => {
  const { base, token } = await boot()
  const res = await fetch(`${base}/nonexistent`, { headers: { 'x-hearth-token': token } })
  expect(res.status).toBe(404)
})

// U8: DNS-rebinding defense — only requests addressed to exactly the bound
// loopback host, with no browser Origin, get past the front door.
test('a valid token with a foreign Host (rebinding shape) is rejected', async () => {
  const { base, token } = await boot()
  const res = await fetch(`${base}/snapshot`, {
    headers: { 'x-hearth-token': token, host: 'attacker.example' },
  })
  expect(res.status).toBe(403)
})

test('a valid token with a browser Origin present is rejected', async () => {
  const { base, token } = await boot()
  const res = await fetch(`${base}/snapshot`, {
    headers: { 'x-hearth-token': token, origin: 'https://attacker.example' },
  })
  expect(res.status).toBe(403)
})

test('correct Host + valid token is served exactly as before', async () => {
  const { base, token } = await boot()
  // bun's fetch sets Host to the URL authority (127.0.0.1:<port>) by default.
  const res = await fetch(`${base}/nonexistent`, { headers: { 'x-hearth-token': token } })
  expect(res.status).toBe(404)
})

test('a wrong Host with a wrong token still fails closed (403 before 401)', async () => {
  const { base } = await boot()
  const res = await fetch(`${base}/eval`, {
    method: 'POST',
    headers: { host: 'attacker.example' },
    body: JSON.stringify({ code: '1' }),
  })
  expect(res.status).toBe(403)
})
