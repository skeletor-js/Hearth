// Codex backend — wired in v2. Same Agent interface, different adapter.
//
// Codex's ACP support is community-maintained (e.g. beyond5959/acp-adapter),
// not first-party, so expect feature gaps vs Claude. The point of this file is
// that adding Codex is "resolve a different adapter spec" — the renderer and
// the rest of main are unchanged.

import type { Agent, AgentConfig, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

export class CodexAgent implements Agent {
  readonly kind = 'codex' as const

  constructor(_config: AgentConfig) {}

  connect(): Promise<void> {
    throw new Error('Codex backend not implemented — v2. See docs/MILESTONE-V1.md')
  }
  newSession(): Promise<AgentSession> {
    throw new Error('Codex backend not implemented — v2')
  }
  onUpdate(_cb: (s: string, u: SessionUpdate) => void): () => void {
    return () => {}
  }
  onPermission(_cb: (s: string, r: PermissionRequest) => Promise<string>): void {}
  dispose(): Promise<void> {
    return Promise.resolve()
  }
}
