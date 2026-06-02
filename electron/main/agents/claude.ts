// Claude Code backend. Spawns @zed-industries/claude-agent-acp, which vendors
// the Claude Code CLI and exposes it over ACP. This is the v1 backend.
//
// Auth: we inherit the user's existing Claude Code auth (they ran `claude
// login`) by spawning in their environment, OR pass through a BYO API key from
// their env. We never originate or store a credential. See COMPLIANCE.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AdapterSpec, type McpServerProvider } from './acp-client.js'
import { AcpAgent, resolveAdapterBin } from './acp-agent.js'
import type { AgentConfig } from './agent.js'

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
  // Run the vendored claude-agent-acp bin, not whatever `claude` is on PATH.
  const bin = resolveAdapterBin('@zed-industries/claude-agent-acp', 'claude-agent-acp')

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
