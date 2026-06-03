import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityStore } from './capabilities'
import { CredentialBroker, resolveProxy } from './broker'

describe('resolveProxy', () => {
  const tokenToApp = (t: string) => (t === 'good' ? 'inbox' : undefined)
  const approvedFor = (app: string) => (app === 'inbox' ? ['https://api.example.com'] : [])

  test('rejects a missing token', () => {
    const d = resolveProxy({ token: undefined, target: 'https://api.example.com/x', tokenToApp, approvedFor })
    expect(d).toEqual({ ok: false, status: 401, error: 'missing broker token' })
  })

  test('rejects an unknown token', () => {
    const d = resolveProxy({ token: 'nope', target: 'https://api.example.com/x', tokenToApp, approvedFor })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.status).toBe(401)
  })

  test('rejects a non-approved host', () => {
    const d = resolveProxy({ token: 'good', target: 'https://evil.com/x', tokenToApp, approvedFor })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.status).toBe(403)
  })

  test('allows an approved host', () => {
    const d = resolveProxy({ token: 'good', target: 'https://api.example.com/v1/messages', tokenToApp, approvedFor })
    expect(d).toEqual({ ok: true, appName: 'inbox', target: 'https://api.example.com/v1/messages', origin: 'https://api.example.com' })
  })

  test('rejects an invalid target', () => {
    const d = resolveProxy({ token: 'good', target: 'not a url', tokenToApp, approvedFor })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.status).toBe(400)
  })
})

describe('CredentialBroker (end to end, injected fetch)', () => {
  let broker: CredentialBroker | null = null
  let tmp: string | null = null

  afterEach(async () => {
    if (broker) await broker.close()
    broker = null
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = null
  })

  function setup(secret?: string) {
    tmp = mkdtempSync(join(tmpdir(), 'hearth-broker-'))
    const caps = new CapabilityStore(join(tmp, 'capabilities.json'))
    caps.approve('inbox', ['https://api.example.com'])
    const secrets = { get: (k: string) => (k === 'microapp.https://api.example.com' ? secret : undefined) }
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    broker = new CredentialBroker({ capabilities: caps, secrets, fetchImpl })
    return { caps, calls }
  }

  test('forwards to an approved host and injects the secret server-side', async () => {
    const { calls } = setup('s3cr3t-token')
    await broker!.start()
    const token = broker!.tokenFor('inbox')

    const res = await fetch(`${broker!.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': token, 'x-hearth-target': 'https://api.example.com/v1/me', 'x-hearth-method': 'GET' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // The upstream call carried the injected Authorization header...
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example.com/v1/me')
    const sent = new Headers(calls[0].init?.headers as HeadersInit)
    expect(sent.get('authorization')).toBe('Bearer s3cr3t-token')
  })

  test('the secret never appears in the broker response to the frame', async () => {
    setup('s3cr3t-token')
    await broker!.start()
    const token = broker!.tokenFor('inbox')
    const res = await fetch(`${broker!.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': token, 'x-hearth-target': 'https://api.example.com/v1/me' },
    })
    const text = await res.text()
    expect(text).not.toContain('s3cr3t-token')
    expect(res.headers.get('authorization')).toBeNull()
  })

  test('denies a non-approved host with 403', async () => {
    setup('s3cr3t-token')
    await broker!.start()
    const token = broker!.tokenFor('inbox')
    const res = await fetch(`${broker!.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': token, 'x-hearth-target': 'https://evil.com/steal' },
    })
    expect(res.status).toBe(403)
  })

  test('denies a bad token with 401', async () => {
    setup('s3cr3t-token')
    await broker!.start()
    const res = await fetch(`${broker!.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': 'forged', 'x-hearth-target': 'https://api.example.com/v1/me' },
    })
    expect(res.status).toBe(401)
  })

  test('per-app tokens are distinct and do not collide', async () => {
    setup('s3cr3t-token')
    await broker!.start()
    const a = broker!.tokenFor('inbox')
    const b = broker!.tokenFor('other')
    expect(a).not.toBe(b)
    // Reissue is stable per app.
    expect(broker!.tokenFor('inbox')).toBe(a)
  })

  test('does not follow a redirect and never re-sends the credential', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'hearth-broker-'))
    const caps = new CapabilityStore(join(tmp, 'capabilities.json'))
    caps.approve('inbox', ['https://api.example.com'])
    const secrets = { get: (k: string) => (k === 'microapp.https://api.example.com' ? 's3cr3t-token' : undefined) }
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url))
      // Approved host responds with a redirect to loopback — the SSRF attempt.
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/' } })
    }) as unknown as typeof fetch
    broker = new CredentialBroker({ capabilities: caps, secrets, fetchImpl })
    await broker.start()
    const token = broker.tokenFor('inbox')

    const res = await fetch(`${broker.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': token, 'x-hearth-target': 'https://api.example.com/v1/me' },
    })
    expect(res.status).toBe(502)
    // Exactly one upstream call — the redirect target was never fetched.
    expect(calls).toEqual(['https://api.example.com/v1/me'])
  })

  test('rejects an over-large request body with 413', async () => {
    setup('s3cr3t-token')
    await broker!.start()
    const token = broker!.tokenFor('inbox')
    const res = await fetch(`${broker!.origin()}/proxy`, {
      method: 'POST',
      headers: { 'x-hearth-token': token, 'x-hearth-target': 'https://api.example.com/v1/me', 'x-hearth-method': 'POST' },
      body: Buffer.alloc(6 * 1024 * 1024),
    })
    expect(res.status).toBe(413)
  })

  test('answers CORS preflight', async () => {
    setup()
    await broker!.start()
    const res = await fetch(`${broker!.origin()}/proxy`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('x-hearth-token')
  })
})
