// Credential broker (W7 of the sandbox-hardening plan).
//
// A micro-app frame must never hold a raw secret: it is untrusted, and an opaque-
// origin sandboxed frame that held an OAuth token could exfiltrate it. So a frame
// that needs to call an authed external API does NOT call it directly — it calls
// this loopback broker, which (1) checks the caller's per-app token, (2) enforces
// the app's user-approved host allowlist (W6), (3) injects the credential from the
// encrypted SecretStore server-side, and (4) forwards the request. The token the
// frame holds only grants reach to that app's already-approved hosts; the actual
// secret never crosses into renderer-readable space.
//
// Credential convention: the secret for host `https://api.example.com` is stored
// under the SecretStore key `microapp.https://api.example.com`. When present, the
// broker adds `Authorization: Bearer <secret>`. Linking a service (the OAuth dance
// that produces that token) is handled in main via the existing secrets UI — never
// in the frame. Richer auth schemes are a follow-up.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { CapabilityStore } from './capabilities.js'
import { normalizeHost } from './capabilities.js'

interface SecretLookup {
  get(key: string): string | undefined
}

export interface BrokerDeps {
  capabilities: CapabilityStore
  secrets: SecretLookup
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export type ProxyDecision =
  | { ok: true; appName: string; target: string; origin: string }
  | { ok: false; status: number; error: string }

/**
 * Pure decision: given a request token + target URL, decide whether to forward.
 * Validates the token → app, that the target is an https origin, and that the
 * origin is in that app's approved set. Unit-tested.
 */
export function resolveProxy(args: {
  token: string | undefined
  target: string | undefined
  tokenToApp: (token: string) => string | undefined
  approvedFor: (appName: string) => string[]
}): ProxyDecision {
  const { token, target, tokenToApp, approvedFor } = args
  if (!token) return { ok: false, status: 401, error: 'missing broker token' }
  const appName = tokenToApp(token)
  if (!appName) return { ok: false, status: 401, error: 'unknown broker token' }
  if (!target) return { ok: false, status: 400, error: 'missing target' }
  let origin: string
  try {
    origin = new URL(target).origin
  } catch {
    return { ok: false, status: 400, error: 'invalid target URL' }
  }
  const normalized = normalizeHost(origin)
  if (!normalized) return { ok: false, status: 400, error: 'target is not an allowed https origin' }
  if (!approvedFor(appName).includes(normalized)) {
    return { ok: false, status: 403, error: `host not approved for ${appName}: ${normalized}` }
  }
  return { ok: true, appName, target, origin: normalized }
}

// Methods a frame may proxy. No TRACE/CONNECT.
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
// Request headers we pass through from the frame (never auth — the broker sets that).
const FORWARDABLE_REQ_HEADERS = ['content-type', 'accept']

export class CredentialBroker {
  private server: Server | null = null
  private port = 0
  private readonly tokenToApp = new Map<string, string>()
  private readonly appToToken = new Map<string, string>()
  private readonly fetchImpl: typeof fetch

  constructor(private readonly deps: BrokerDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  /** Start listening on a random loopback port. */
  start(): Promise<void> {
    if (this.server) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') this.port = addr.port
        this.server = server
        resolve()
      })
    })
  }

  /** The broker origin a frame calls and that must be in its CSP connect-src. */
  origin(): string | null {
    return this.server ? `http://127.0.0.1:${this.port}` : null
  }

  /** Issue (or reuse) a per-app token. Tokens are not reachable across apps. */
  tokenFor(appName: string): string {
    const existing = this.appToToken.get(appName)
    if (existing) return existing
    const token = randomBytes(32).toString('hex')
    this.appToToken.set(appName, token)
    this.tokenToApp.set(token, appName)
    return token
  }

  close(): Promise<void> {
    const server = this.server
    if (!server) return Promise.resolve()
    this.server = null
    return new Promise((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS: the frame has an opaque origin (sandbox without allow-same-origin), so
    // it sends `Origin: null`. The broker is loopback + token-gated, so reflecting
    // a permissive CORS policy is safe and lets the frame read the response.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type, x-hearth-token, x-hearth-target, x-hearth-method')
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST' || req.url !== '/proxy') {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const decision = resolveProxy({
      token: header(req, 'x-hearth-token'),
      target: header(req, 'x-hearth-target'),
      tokenToApp: (t) => this.tokenToApp.get(t),
      approvedFor: (app) => this.deps.capabilities.approved(app),
    })
    if (!decision.ok) {
      res.writeHead(decision.status, { 'content-type': 'text/plain' })
      res.end(decision.error)
      return
    }

    const method = (header(req, 'x-hearth-method') ?? 'GET').toUpperCase()
    if (!ALLOWED_METHODS.has(method)) {
      res.writeHead(405, { 'content-type': 'text/plain' })
      res.end('method not allowed')
      return
    }

    const headers: Record<string, string> = {}
    for (const name of FORWARDABLE_REQ_HEADERS) {
      const v = req.headers[name]
      if (typeof v === 'string') headers[name] = v
    }
    // Inject the credential server-side. The frame never sees it.
    const secret = this.deps.secrets.get(`microapp.${decision.origin}`)
    if (secret) headers['authorization'] = `Bearer ${secret}`

    const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req)

    try {
      const upstream = await this.fetchImpl(decision.target, { method, headers, body })
      const buf = Buffer.from(await upstream.arrayBuffer())
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      res.writeHead(upstream.status, { 'content-type': contentType, 'access-control-allow-origin': '*' })
      res.end(buf)
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(`upstream error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return typeof v === 'string' ? v : undefined
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
