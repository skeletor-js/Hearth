// Shared backend plumbing. Every ACP backend (Claude, Codex) is the same thing:
// an AcpClient driven by a spec that says which adapter subprocess to launch.
// The per-backend files (claude.ts, codex.ts) only differ in *which* adapter bin
// they resolve and how they pass the user's auth — everything else (the ACP
// handshake, streaming, permission routing, diffs) lives in AcpClient and is
// identical across backends.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AcpClient, type AdapterSpec, type McpServerProvider } from './acp-client.js'
import type { Agent, AgentKind, AgentSession, AuthMethodInfo, AvailableCommand, PermissionRequest, PromptCapabilities, SessionUpdate } from './agent.js'

/**
 * Resolve a published adapter's launchable entry from its package.json `bin`.
 * These adapters expose only a bin (no main export), so we read package.json and
 * follow the bin path — running the vendored adapter, not whatever is on PATH.
 */
export function resolveAdapterBin(pkgName: string, binName: string): string {
  const require = createRequire(import.meta.url)
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`)
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { bin?: string | Record<string, string> }
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName]
  if (!binRel) throw new Error(`${pkgName} exposes no bin "${binName}" to launch`)
  return join(dirname(pkgJsonPath), binRel)
}

/**
 * The Agent implementation shared by all ACP backends. A backend subclass passes
 * its kind and a lazy spec factory (resolution runs in connect(), so a missing
 * bin or auth failure surfaces through connect()'s rejection rather than crashing
 * construction — and handlers can register before connect()).
 */
export class AcpAgent implements Agent {
  protected readonly client: AcpClient

  constructor(
    readonly kind: AgentKind,
    resolveSpec: () => AdapterSpec,
    userMcpServers?: McpServerProvider,
  ) {
    this.client = new AcpClient(resolveSpec, userMcpServers)
  }

  connect(): Promise<void> {
    return this.client.connect()
  }
  newSession(opts?: { cwd?: string }): Promise<AgentSession> {
    return this.client.newSession(opts)
  }
  resumeSession(acpSessionId: string, opts?: { cwd?: string }): Promise<AgentSession> {
    return this.client.resumeSession(acpSessionId, opts)
  }
  onUpdate(cb: (sessionId: string, update: SessionUpdate) => void): () => void {
    return this.client.onUpdate(cb)
  }
  onPermission(cb: (sessionId: string, req: PermissionRequest) => Promise<string>): void {
    this.client.onPermission(cb)
  }
  promptCapabilities(): PromptCapabilities {
    return this.client.promptCapabilities()
  }
  authMethods(): AuthMethodInfo[] {
    return this.client.authMethods()
  }
  advertisedCommands(): AvailableCommand[] {
    return this.client.advertisedCommands()
  }
  dispose(): Promise<void> {
    return this.client.dispose()
  }
}
