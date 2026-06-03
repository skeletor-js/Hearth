// Session-level security policy: deny-by-default device permissions (W2) and
// Hearth-enforced Content-Security-Policy headers (W3 for the shell, W6 per-app
// for micro-apps). These are injected by Hearth's own session, NOT by the
// agent-authored micro-app Vite config, so an untrusted app can't strip them.
//
// The per-app micro-app CSP is the single source of truth for egress: a fresh app
// gets connect-src 'self' + its own HMR socket + the broker, and nothing else; an
// app the user has granted hosts to (capabilities.ts) gets exactly those hosts
// added. The micro-app's index.html meta CSP deliberately omits connect-src so it
// can't intersect away a grant (see templates/micro-app/index.html).

import type { Session } from 'electron'
import { microAppForOrigin } from './server.js'
import type { CapabilityStore } from './capabilities.js'

export interface SessionPolicyDeps {
  /** Origins the shell document is served from (dev URL / packaged Vite / file). */
  shellOrigins: string[]
  capabilities: CapabilityStore
  /** Loopback broker origin micro-apps may call; null until the broker starts. */
  brokerOrigin: () => string | null
}

/** Build the per-app micro-app CSP from its approved hosts. Pure + tested. */
export function buildMicroAppCsp(selfOrigin: string, approvedHosts: string[], brokerOrigin: string | null): string {
  // 'self' covers same-origin http(s); Vite HMR inside the frame needs its own
  // ws/wss origin spelled out. Approved external hosts + the broker round it out.
  const wsSelf = selfOrigin.replace(/^http/, 'ws')
  const connect = ["'self'", wsSelf, ...approvedHosts]
  if (brokerOrigin) connect.push(brokerOrigin)
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

/** Build the shell CSP header. Mirrors index.html's meta + frame-ancestors. Pure. */
export function buildShellCsp(): string {
  return [
    "default-src 'self'",
    // The shell is Hearth's own first-party renderer, served by Vite in BOTH dev
    // and packaged self-evolving builds. Vite injects an inline React-refresh
    // preamble; a header CSP (unlike the order-dependent meta tag) applies to the
    // whole document, so 'unsafe-inline' is required here or the renderer never
    // mounts. The untrusted surface is micro-apps, whose egress is locked down by
    // their own (separate) per-app CSP — not the shell.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // The shell only connects to its own Vite HMR socket (dev + packaged self-
    // evolving builds both run Vite), which is always loopback — so scope ws to
    // loopback rather than the scheme-wide `ws:` (which allowed a socket to ANY
    // host). Micro-app frames are governed separately by frame-src, not connect-src.
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
    'frame-src http://localhost:* http://127.0.0.1:*',
    "object-src 'none'",
    "base-uri 'self'",
    // The shell must never be embeddable by anything.
    "frame-ancestors 'none'",
  ].join('; ')
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Install permission denial + CSP injection on a session. Idempotent per session
 * is not guaranteed by Electron (the last handler wins), so call once at boot.
 */
export function installSessionPolicy(session: Session, deps: SessionPolicyDeps): void {
  // W2: deny every powerful feature (camera, mic, geolocation, notifications, …).
  // Hearth needs none of these for itself, and micro-apps must never get them.
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  const shellOrigins = new Set(deps.shellOrigins.map(originOf).filter((o): o is string => o !== null))

  // W3 + W6: stamp the authoritative CSP on shell and micro-app documents.
  session.webRequest.onHeadersReceived((details, callback) => {
    const origin = originOf(details.url)
    let csp: string | null = null
    if (origin) {
      const appName = microAppForOrigin(origin)
      if (appName) {
        csp = buildMicroAppCsp(origin, deps.capabilities.approved(appName), deps.brokerOrigin())
      } else if (shellOrigins.has(origin)) {
        csp = buildShellCsp()
      }
    }
    if (!csp) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    // Replace any upstream CSP (case-insensitively) with ours — ours is authoritative.
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key]
    }
    headers['Content-Security-Policy'] = [csp]
    callback({ responseHeaders: headers })
  })
}
