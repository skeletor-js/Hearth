// Per-app egress capability grants (W6 of the sandbox-hardening plan).
//
// A micro-app's code is agent-authored and untrusted. By default it can reach
// nothing external (the per-app CSP floor in session-policy.ts). To connect a
// micro-app to a real service (e.g. Google Workspace), the agent *requests* hosts
// in a manifest (micro-apps/<name>/hearth.app.json); the USER approves them; and
// only the approved set — stored here, never the agent-editable manifest — widens
// that one app's connect-src. A hostile app cannot self-grant: editing its
// manifest just moves a host back to "pending" until the user approves it again.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertAppName } from './validate.js'

export interface HostRequest {
  /** A normalized https origin, e.g. "https://www.googleapis.com". */
  host: string
  /** Human-readable justification shown in the approval prompt. */
  reason: string
}

export interface AppCapabilities {
  /** Hosts the user has approved for this app — the source of truth for egress. */
  approved: string[]
  /** Requested-but-not-yet-approved hosts (manifest minus approved). */
  pending: HostRequest[]
}

// Hosts we never allow regardless of approval: loopback / unspecified / link-local,
// which would let a frame reach Hearth's own broker or other local services and
// turn an egress grant into local SSRF.
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

// A real, public-looking dotted DNS name: two or more labels, each alphanumeric
// with internal hyphens. Rejects wildcards, bare single labels, and IP literals.
const VALID_HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Normalize a requested host to an exact https origin, or null if it isn't one we
 * permit. Only https, only an origin (scheme+host+optional port) — no paths, no
 * wildcards, no embedded credentials, no loopback. Pure + unit-tested.
 */
export function normalizeHost(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.pathname !== '/' && u.pathname !== '') return null
  if (u.search || u.hash) return null
  const host = u.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return null
  if (!VALID_HOSTNAME.test(host)) return null
  return u.origin
}

interface RawManifest {
  hosts?: Array<{ host?: unknown; reason?: unknown }>
}

/**
 * Read + validate a micro-app's requested hosts from its manifest. Unknown,
 * malformed, or disallowed entries are dropped (never throws — a bad manifest
 * just yields fewer requests). Pure given the filesystem.
 */
export function readManifest(repoRoot: string, name: string): HostRequest[] {
  assertAppName(name)
  const path = join(repoRoot, 'micro-apps', name, 'hearth.app.json')
  if (!existsSync(path)) return []
  let parsed: RawManifest
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as RawManifest
  } catch {
    return []
  }
  if (!parsed || !Array.isArray(parsed.hosts)) return []
  const seen = new Set<string>()
  const out: HostRequest[] = []
  for (const entry of parsed.hosts) {
    const host = normalizeHost(typeof entry?.host === 'string' ? entry.host : '')
    if (!host || seen.has(host)) continue
    seen.add(host)
    out.push({ host, reason: typeof entry?.reason === 'string' ? entry.reason : '' })
  }
  return out
}

type StoreShape = Record<string, { approved: string[] }>

/**
 * The approved-host store. Persisted under userData as plain JSON (the approved
 * host list is not a secret — the secrets themselves live in SecretStore). The
 * approved set, not the manifest, is authoritative.
 */
export class CapabilityStore {
  private map: StoreShape = {}

  constructor(private readonly filePath: string) {
    this.load()
  }

  /** Approved https origins for an app (empty if none). */
  approved(name: string): string[] {
    return this.map[name]?.approved ?? []
  }

  /** Approve a set of hosts for an app. Non-https/invalid hosts are ignored. */
  approve(name: string, hosts: string[]): void {
    assertAppName(name)
    const valid = hosts.map(normalizeHost).filter((h): h is string => h !== null)
    if (valid.length === 0) return
    const current = new Set(this.approved(name))
    for (const h of valid) current.add(h)
    this.map[name] = { approved: [...current].sort() }
    this.persist()
  }

  /** Revoke one host (or all, if host omitted) for an app. */
  revoke(name: string, host?: string): void {
    assertAppName(name)
    if (!this.map[name]) return
    if (host === undefined) {
      delete this.map[name]
    } else {
      const normalized = normalizeHost(host) ?? host
      this.map[name] = { approved: this.approved(name).filter((h) => h !== normalized) }
    }
    this.persist()
  }

  /** Approved + pending (manifest-requested but not approved) for the UI. */
  capabilities(repoRoot: string, name: string): AppCapabilities {
    const approved = this.approved(name)
    const approvedSet = new Set(approved)
    const pending = readManifest(repoRoot, name).filter((r) => !approvedSet.has(r.host))
    return { approved, pending }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreShape
      this.map = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      this.map = {}
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.map, null, 2), { mode: 0o600 })
  }
}
