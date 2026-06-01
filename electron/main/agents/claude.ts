// Claude Code backend. Spawns @zed-industries/claude-agent-acp, which vendors
// the Claude Code CLI and exposes it over ACP. This is the v1 backend.
//
// Auth: we inherit the user's existing Claude Code auth (they ran `claude
// login`) by spawning in their environment, OR pass through a BYO API key from
// their env. We never originate or store a credential. See COMPLIANCE.md.

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AcpClient, type AdapterSpec } from './acp-client.js'
import type { Agent, AgentConfig, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

// Permission modes the bundled adapter understands directly (its alias table).
const ADAPTER_MODES = new Set(['default', 'acceptedits', 'dontask', 'plan', 'bypasspermissions', 'bypass'])
// Newer Claude Code modes the (older) adapter doesn't know yet → closest equivalent.
// "auto" (auto-accept) maps to acceptEdits, NOT bypassPermissions: we keep the
// safe reading rather than letting the agent run commands unprompted.
const MODE_TRANSLATION: Record<string, string> = { auto: 'acceptEdits' }

// Resolve the permission mode for Hearth's agent. Defaults to "auto" (matching a
// common Claude Code setup); override with HEARTH_PERMISSION_MODE. The bundled
// adapter crashes on modes it can't parse (e.g. "auto"), so we translate to a
// value it accepts and pin it at PROJECT scope — keeping the user on their normal
// ~/.claude config dir (so their login resolves exactly as it does for `claude`).
function ensureProjectPermissionMode(cwd: string): string {
  const requested = (process.env.HEARTH_PERMISSION_MODE ?? 'auto').trim().toLowerCase()
  const mode = MODE_TRANSLATION[requested] ?? (ADAPTER_MODES.has(requested) ? requested : 'acceptEdits')

  const dir = join(cwd, '.claude')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'settings.local.json')
  let current: { permissions?: Record<string, unknown> } = {}
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      current = {}
    }
  }
  current.permissions = { ...current.permissions, defaultMode: mode }
  writeFileSync(file, JSON.stringify(current, null, 2) + '\n')
  return mode
}

function resolveAdapter(config: AgentConfig): AdapterSpec {
  const require = createRequire(import.meta.url)
  // The adapter package exposes only a `bin`, no main export — resolve its
  // package.json and follow `bin` to the real entry, so we run the vendored
  // CLI rather than whatever `claude` happens to be on PATH.
  const pkgJsonPath = require.resolve('@zed-industries/claude-agent-acp/package.json')
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { bin?: string | Record<string, string> }
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['claude-agent-acp']
  if (!binRel) throw new Error('@zed-industries/claude-agent-acp exposes no bin to launch')
  const bin = join(dirname(pkgJsonPath), binRel)

  // Resolve + pin the agent's permission mode (default "auto"; HEARTH_PERMISSION_MODE
  // to change). Uses the user's normal ~/.claude config dir for everything else, so
  // their login resolves exactly as it does for `claude`. See COMPLIANCE.md: we
  // never store the credential.
  const mode = ensureProjectPermissionMode(config.cwd)
  console.log(`[hearth] agent permission mode: ${mode}`)

  // process.execPath is the Electron binary in the packaged/dev app. To run the
  // adapter's Node entry with it we must set ELECTRON_RUN_AS_NODE, or Electron
  // would try to boot a second app instead of executing the script. (Under a
  // plain Node/Bun runtime this var is simply ignored.)
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
  if (config.auth.mode === 'api-key') {
    const key = process.env[config.auth.envVar]
    if (!key) throw new Error(`API key env var ${config.auth.envVar} is not set`)
    env.ANTHROPIC_API_KEY = key
  }
  // subscription mode: inject nothing; the adapter uses the user's login.

  return { command: process.execPath, args: [bin], cwd: config.cwd, env }
}

export class ClaudeAgent implements Agent {
  readonly kind = 'claude' as const
  private client: AcpClient

  constructor(config: AgentConfig) {
    // Pass a lazy spec factory: the client is created here (cheap — just handler
    // sets, so onUpdate/onPermission can register before connect), but adapter
    // resolution runs inside connect() so a resolution or auth failure surfaces
    // through connect()'s rejection path instead of crashing bootstrap.
    this.client = new AcpClient(() => resolveAdapter(config))
  }

  connect() {
    return this.client.connect()
  }
  newSession(): Promise<AgentSession> {
    return this.client.newSession()
  }
  onUpdate(cb: (s: string, u: SessionUpdate) => void) {
    return this.client.onUpdate(cb)
  }
  onPermission(cb: (s: string, r: PermissionRequest) => Promise<string>) {
    this.client.onPermission(cb)
  }
  dispose() {
    return this.client.dispose()
  }
}
