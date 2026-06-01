// Claude Code backend. Spawns @zed-industries/claude-agent-acp, which vendors
// the Claude Code CLI and exposes it over ACP. This is the v1 backend.
//
// Auth: we inherit the user's existing Claude Code auth (they ran `claude
// login`) by spawning in their environment, OR pass through a BYO API key from
// their env. We never originate or store a credential. See COMPLIANCE.md.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AcpClient, type AdapterSpec } from './acp-client.js'
import type { Agent, AgentConfig, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

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

  const env: Record<string, string> = {}
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
