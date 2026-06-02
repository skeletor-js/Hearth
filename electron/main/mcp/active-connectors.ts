// Read-only view of the MCP connectors each backend will actually load. The ACP
// adapters merge the user's own CLI config into every Hearth session (Claude:
// ~/.claude.json user-scope + per-project local-scope + project .mcp.json; Codex:
// ~/.codex/config.toml). Hearth doesn't manage these — the CLIs do — so this is
// strictly read-only: we surface name + transport + scope so the user can SEE
// what's active and trust it. We never read, store, or log auth values (headers /
// env / tokens) — only whether auth is configured at all. See docs/COMPLIANCE.md.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActiveConnector, ActiveConnectors } from '../../shared/protocol.js'
import { cliResolves } from '../terminal/login-path.js'

/** Read what both backends will load for a given workspace. Never throws. */
export function readActiveConnectors(cwd: string): ActiveConnectors {
  return {
    claude: safe(() => readClaude(cwd)),
    codex: safe(() => readCodex()),
    claudeCli: cliResolves('claude'),
    codexCli: cliResolves('codex'),
  }
}

function safe(fn: () => ActiveConnector[]): ActiveConnector[] {
  try {
    return fn()
  } catch {
    return []
  }
}

// ── Claude: ~/.claude.json (+ project .mcp.json) ────────────────────────────
// user scope  = top-level `mcpServers`
// local scope = `projects["<cwd>"].mcpServers`
// project     = `<cwd>/.mcp.json` -> `mcpServers`
function readClaude(cwd: string): ActiveConnector[] {
  const claudeJson = join(homedir(), '.claude.json')
  const root = existsSync(claudeJson) ? (JSON.parse(readFileSync(claudeJson, 'utf8')) as ClaudeConfig) : {}
  const mcpJson = join(cwd, '.mcp.json')
  const proj = existsSync(mcpJson)
    ? (JSON.parse(readFileSync(mcpJson, 'utf8')) as { mcpServers?: Record<string, unknown> })
    : undefined
  return parseClaudeConnectors(root, cwd, proj?.mcpServers)
}

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>
}

/** Pure parse of Claude's config objects into connectors (testable, no IO). */
export function parseClaudeConnectors(
  root: ClaudeConfig,
  cwd: string,
  projectServers?: Record<string, unknown>,
): ActiveConnector[] {
  const out: ActiveConnector[] = []
  collect(out, root.mcpServers, 'user')
  collect(out, root.projects?.[cwd]?.mcpServers, 'local')
  collect(out, projectServers, 'project')
  return out
}

function collect(out: ActiveConnector[], servers: Record<string, unknown> | undefined, scope: ActiveConnector['scope']): void {
  if (!servers || typeof servers !== 'object') return
  for (const [name, raw] of Object.entries(servers)) {
    const s = (raw ?? {}) as Record<string, unknown>
    const url = typeof s.url === 'string' ? s.url : undefined
    const declared = typeof s.type === 'string' ? s.type : typeof s.transport === 'string' ? s.transport : undefined
    const transport: ActiveConnector['transport'] =
      declared === 'http' || declared === 'sse' ? declared : url ? 'http' : 'stdio'
    const command = typeof s.command === 'string' ? s.command : undefined
    out.push({
      name,
      scope,
      transport,
      target: url ?? command ?? '',
      // presence only — never the value
      hasAuth: hasEntries(s.headers) || hasEntries(s.env),
    })
  }
}

function hasEntries(v: unknown): boolean {
  return !!v && typeof v === 'object' && Object.keys(v as object).length > 0
}

// ── Codex: ~/.codex/config.toml ─────────────────────────────────────────────
// Minimal reader for `[mcp_servers.<name>]` tables only — NOT a general TOML
// parser. We extract the keys we display (command / url / transport) and detect
// whether env/headers are present; unknown lines are ignored so it degrades
// gracefully rather than throwing on TOML we don't model.
function readCodex(): ActiveConnector[] {
  const path = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(path)) return []
  return parseCodexConnectors(readFileSync(path, 'utf8'))
}

/** Pure parse of Codex's config.toml into connectors (testable, no IO). Minimal
 * `[mcp_servers.<name>]` reader — see the note above; not a general TOML parser. */
export function parseCodexConnectors(text: string): ActiveConnector[] {
  const lines = text.split(/\r?\n/)
  const servers = new Map<string, { url?: string; command?: string; transport?: string; auth: boolean }>()
  let current: string | null = null
  let inSub = false // inside a `[mcp_servers.<name>.<sub>]` table (e.g. .env / .headers)
  for (const rawLine of lines) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    if (line.startsWith('[')) {
      // Server name is the single segment after `mcp_servers.`; deeper segments
      // (e.g. `.env`, `.headers`) are SUBTABLES of that server, not new servers.
      const m = line.match(/^\[\[?\s*mcp_servers\.([A-Za-z0-9_-]+)\s*(\.[^\]]+?)?\s*\]\]?$/)
      if (m) {
        current = m[1]
        inSub = !!m[2]
        if (!servers.has(current)) servers.set(current, { auth: false })
        if (inSub && /^\.(env|headers)\b/.test(m[2]!)) servers.get(current)!.auth = true
      } else {
        current = null // some other table — stop attributing keys to a server
        inSub = false
      }
      continue
    }
    if (!current) continue
    if (inSub) continue // keys belong to a subtable; the header already recorded auth
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/)
    if (!kv) continue
    const s = servers.get(current)!
    const key = kv[1]
    const val = unquote(kv[2].trim())
    if (key === 'url') s.url = val
    else if (key === 'command') s.command = val
    else if (key === 'transport' || key === 'type') s.transport = val
    else if (key === 'env' || key === 'headers' || key.startsWith('env.') || key.startsWith('headers.')) s.auth = true
  }
  const out: ActiveConnector[] = []
  for (const [name, s] of servers) {
    const transport: ActiveConnector['transport'] =
      s.transport === 'http' || s.transport === 'sse' ? s.transport : s.url ? 'http' : 'stdio'
    out.push({ name, scope: 'user', transport, target: s.url ?? s.command ?? '', hasAuth: s.auth })
  }
  return out
}

function stripComment(line: string): string {
  // Drop an unquoted trailing comment. Good enough for the keys we read.
  let inStr = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inStr = !inStr
    else if (c === '#' && !inStr) return line.slice(0, i)
  }
  return line
}

function unquote(v: string): string {
  const m = v.match(/^"([\s\S]*)"$/) || v.match(/^'([\s\S]*)'$/)
  return m ? m[1] : v
}
