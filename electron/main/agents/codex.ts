// Codex backend. Spawns @agentclientprotocol/codex-acp, which vendors the
// @openai/codex CLI and exposes it over ACP — the same shape as the Claude
// backend, just a different adapter and credential. The renderer and the rest of
// main are unchanged: a backend is "resolve a different adapter spec".
//
// Auth: we inherit the user's existing Codex auth (they ran `codex login`) by
// spawning in their environment, OR pass through a BYO OpenAI API key from their
// env. We never originate or store a credential. See docs/COMPLIANCE.md.

import { AcpAgent, resolveAdapterBin } from './acp-agent.js'
import { type AdapterSpec } from './acp-client.js'
import type { AgentConfig } from './agent.js'

function resolveAdapter(config: AgentConfig): AdapterSpec {
  // Run the vendored codex-acp bin (which drives the vendored @openai/codex),
  // not whatever `codex` is on PATH.
  const bin = resolveAdapterBin('@agentclientprotocol/codex-acp', 'codex-acp')

  // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it run
  // the adapter's Node entry instead of booting a second app. (Ignored under a
  // plain Node/Bun runtime.)
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
  if (config.auth.mode === 'api-key') {
    const key = process.env[config.auth.envVar]
    if (!key) throw new Error(`API key env var ${config.auth.envVar} is not set`)
    env.OPENAI_API_KEY = key
  }
  // subscription mode: inject nothing; the adapter uses the user's `codex login`
  // (~/.codex), the same credential the `codex` CLI uses.

  return { command: process.execPath, args: [bin], cwd: config.cwd, env }
}

export class CodexAgent extends AcpAgent {
  constructor(config: AgentConfig) {
    super('codex', () => resolveAdapter(config))
  }
}
