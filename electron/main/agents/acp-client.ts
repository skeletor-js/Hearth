// Thin wrapper over @agentclientprotocol/sdk's ClientSideConnection.
//
// Responsibilities:
//   - spawn the adapter subprocess (Claude or Codex) with the user's env
//   - speak ACP JSON-RPC over its stdio
//   - translate ACP session/update notifications into our SessionUpdate type
//   - route permission requests up to a handler the renderer answers
//
// This is the only file that imports the ACP SDK. Everything else uses `Agent`.
//
// TODO(v1): implement against the real SDK surface. The SDK names below follow
// @agentclientprotocol/sdk ^0.21 (ClientSideConnection); pin and verify the
// exact method signatures when wiring — they move between minor versions.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

export interface AdapterSpec {
  /** Executable + args that launch the ACP adapter, e.g. the claude-agent-acp bin. */
  command: string
  args: string[]
  cwd: string
  /** Extra env merged over process.env (never inject secrets here — see COMPLIANCE.md). */
  env?: Record<string, string>
}

export type UpdateHandler = (sessionId: string, update: SessionUpdate) => void
export type PermissionHandler = (sessionId: string, req: PermissionRequest) => Promise<string>

export class AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private updateHandlers = new Set<UpdateHandler>()
  private permissionHandler: PermissionHandler | null = null

  // A factory, not a resolved spec: resolution (which can throw — missing bin,
  // missing API key) is deferred to connect() so it fails through the connect
  // rejection path rather than at construction time.
  constructor(private readonly resolveSpec: () => AdapterSpec) {}

  async connect(): Promise<void> {
    const spec = this.resolveSpec()
    this.child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // TODO(v1): wire ClientSideConnection to child.stdout/stdin, register the
    // session/update + requestPermission callbacks, and await `initialize`.
    throw new Error('AcpClient.connect not implemented — see TODO(v1)')
  }

  async newSession(): Promise<AgentSession> {
    // TODO(v1): connection.newSession({ cwd }), return a session that maps
    // prompt()/cancel() onto ACP prompt/cancel calls.
    throw new Error('AcpClient.newSession not implemented — see TODO(v1)')
  }

  onUpdate(cb: UpdateHandler): () => void {
    this.updateHandlers.add(cb)
    return () => this.updateHandlers.delete(cb)
  }

  onPermission(cb: PermissionHandler): void {
    this.permissionHandler = cb
  }

  protected emit(sessionId: string, update: SessionUpdate): void {
    for (const h of this.updateHandlers) h(sessionId, update)
  }

  protected async askPermission(sessionId: string, req: PermissionRequest): Promise<string> {
    if (!this.permissionHandler) throw new Error('no permission handler registered')
    return this.permissionHandler(sessionId, req)
  }

  async dispose(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.updateHandlers.clear()
  }
}
