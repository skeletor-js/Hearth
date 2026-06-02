// Claude Code backend. Spawns @zed-industries/claude-agent-acp, which vendors
// the Claude Code CLI and exposes it over ACP. This is the v1 backend.
//
// Auth: we inherit the user's existing Claude Code auth (they ran `claude
// login`) by spawning in their environment, OR pass through a BYO API key from
// their env. We never originate or store a credential. See COMPLIANCE.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type AdapterSpec, type McpServerProvider } from './acp-client.js'
import { AcpAgent, resolveAdapterBin } from './acp-agent.js'
import type { AgentConfig } from './agent.js'

// Permission mode is driven at RUNTIME over ACP now (`setSessionMode`, applied per
// session by the AgentHost — both backends start at the Default/prompt baseline).
// The static settings-file pin Hearth used to write is gone.
//
// BUT: the bundled claude-agent-acp (0.23.1) resolves `permissions.defaultMode`
// from the merged CLI settings at *every* `session/new` and HARD-CRASHES on a value
// it can't parse (e.g. `auto`, which newer Claude CLIs accept but this adapter does
// not). A user with `defaultMode: "auto"` in ~/.claude/settings.json would break
// session creation before runtime mode control ever runs. So we keep one narrow
// compatibility shim: only when the user's *effective* merged defaultMode is
// unparseable do we write a parseable baseline (`default`) into the project's
// settings.local.json (highest precedence) to shield the adapter. We never touch a
// valid user setting, never write other keys, and never clobber hooks/allow/etc.
// (the adapter loads hooks from these files — see ACP-SESSION-SURFACE-PLAN).
const ADAPTER_PARSEABLE_MODES = new Set(['default', 'acceptedits', 'dontask', 'plan', 'bypasspermissions', 'bypass'])

function readDefaultMode(file: string): unknown {
  if (!existsSync(file)) return undefined
  try {
    return (JSON.parse(readFileSync(file, 'utf-8')) as { permissions?: { defaultMode?: unknown } }).permissions?.defaultMode
  } catch {
    return undefined
  }
}

function isParseableMode(v: unknown): boolean {
  return v === undefined || (typeof v === 'string' && ADAPTER_PARSEABLE_MODES.has(v.trim().toLowerCase()))
}

// Shield the adapter from an unparseable merged `defaultMode` (e.g. the user's
// global `auto`). No-op when the effective value is already valid or absent.
function ensureParseablePermissionMode(cwd: string): void {
  const localFile = join(cwd, '.claude', 'settings.local.json')
  // Adapter merge precedence (settingSources user < project < local): last defined wins.
  const local = readDefaultMode(localFile)
  const project = readDefaultMode(join(cwd, '.claude', 'settings.json'))
  const user = readDefaultMode(join(homedir(), '.claude', 'settings.json'))
  const effective = local !== undefined ? local : project !== undefined ? project : user
  if (isParseableMode(effective)) return // adapter can handle it (or it's absent → "default")

  // Write a parseable baseline into local settings (highest precedence), merging
  // surgically so every other key the user owns is preserved.
  const dir = join(cwd, '.claude')
  mkdirSync(dir, { recursive: true })
  let current: { permissions?: Record<string, unknown> } & Record<string, unknown> = {}
  if (existsSync(localFile)) {
    try {
      current = JSON.parse(readFileSync(localFile, 'utf-8'))
    } catch {
      current = {}
    }
  }
  current.permissions = { ...current.permissions, defaultMode: 'default' }
  writeFileSync(localFile, JSON.stringify(current, null, 2) + '\n')
  console.log('[hearth] shielded adapter from unparseable permissions.defaultMode (set local baseline "default")')
}

function resolveAdapter(config: AgentConfig): AdapterSpec {
  // Run the vendored claude-agent-acp bin, not whatever `claude` is on PATH.
  const bin = resolveAdapterBin('@zed-industries/claude-agent-acp', 'claude-agent-acp')

  // Mode is driven at runtime over ACP; this only shields the adapter from an
  // unparseable user defaultMode (no-op otherwise). Everything else resolves from
  // the user's normal ~/.claude config dir, so login works as it does for `claude`.
  ensureParseablePermissionMode(config.cwd)

  // process.execPath is the Electron binary in the packaged/dev app. To run the
  // adapter's Node entry with it we must set ELECTRON_RUN_AS_NODE, or Electron
  // would try to boot a second app instead of executing the script. (Under a
  // plain Node/Bun runtime this var is simply ignored.)
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
  if (config.auth.mode === 'api-key') {
    // The key is the user's own (encrypted in our store, or from their env); we
    // pass it to the child's env, never persisting it ourselves. See COMPLIANCE.md.
    env.ANTHROPIC_API_KEY = config.auth.key
  }
  // subscription mode: inject nothing; the adapter uses the user's login.

  return { command: process.execPath, args: [bin], cwd: config.cwd, env }
}

export class ClaudeAgent extends AcpAgent {
  constructor(config: AgentConfig, userMcpServers?: McpServerProvider) {
    // Lazy spec factory: resolution runs in connect() (see AcpAgent) so a missing
    // bin or auth failure surfaces through connect()'s rejection, not construction.
    super('claude', () => resolveAdapter(config), userMcpServers)
  }
}
