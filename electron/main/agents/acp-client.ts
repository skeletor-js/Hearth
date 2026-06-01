// Thin wrapper over @agentclientprotocol/sdk's ClientSideConnection.
//
// Responsibilities:
//   - spawn the adapter subprocess (Claude or Codex) with the user's env
//   - speak ACP JSON-RPC over its stdio
//   - translate ACP session/update notifications into our SessionUpdate type
//   - route permission requests up to a handler the renderer answers
//
// This is the only file that imports the ACP SDK. Everything else uses `Agent`.
// The protocol-mapping logic lives in (and is tested in) ./acp-translate.ts;
// this file owns the live connection and process lifecycle.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AgentSession, PermissionRequest, SessionUpdate } from './agent.js'
import { translatePermission, translateUpdate } from './acp-translate.js'

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
  private connection: ClientSideConnection | null = null
  private cwd = process.cwd()
  private updateHandlers = new Set<UpdateHandler>()
  private permissionHandler: PermissionHandler | null = null
  // tool-call id -> title, so tool_call_update notifications (which omit the
  // title) can be displayed with a name. See acp-translate.translateUpdate.
  private toolTitles = new Map<string, string>()

  // A factory, not a resolved spec: resolution (which can throw — missing bin,
  // missing API key) is deferred to connect() so it fails through the connect
  // rejection path rather than at construction time.
  constructor(private readonly resolveSpec: () => AdapterSpec) {}

  async connect(): Promise<void> {
    const spec = this.resolveSpec()
    this.cwd = spec.cwd
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    // Surface adapter stderr to our log; it's where the agent reports its own
    // startup/auth failures.
    child.stderr.on('data', (b: Buffer) => process.stderr.write(`[acp adapter] ${b}`))

    // ndJsonStream(output, input): output is the writable we send to (the
    // adapter's stdin), input is the readable we receive on (its stdout).
    const toAgent = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
    const fromAgent = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    const stream = ndJsonStream(toAgent, fromAgent)

    const client: Client = {
      sessionUpdate: async (params: SessionNotification) => {
        for (const update of translateUpdate(params.update, this.toolTitles)) {
          this.emit(params.sessionId, update)
        }
      },
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        try {
          const optionId = await this.askPermission(params.sessionId, translatePermission(params))
          return { outcome: { outcome: 'selected', optionId } }
        } catch {
          // No handler, or the user dismissed/cancelled — tell the agent to stop
          // waiting rather than hang the turn.
          return { outcome: { outcome: 'cancelled' } }
        }
      },
    }

    this.connection = new ClientSideConnection(() => client, stream)
    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      // No fs capability: the agent writes edits directly to disk in cwd, which
      // is exactly what the self-mod git layer needs to observe. See ARCHITECTURE.md.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    })
  }

  async newSession(): Promise<AgentSession> {
    const connection = this.connection
    if (!connection) throw new Error('not connected — call connect() first')

    const { sessionId } = await connection.newSession({ cwd: this.cwd, mcpServers: [] })

    return {
      id: sessionId,
      prompt: async (text: string) => {
        const { stopReason } = await connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text }],
        })
        this.emit(sessionId, { type: 'end', stopReason })
      },
      cancel: async () => {
        await connection.cancel({ sessionId })
      },
      dispose: async () => {
        this.toolTitles.clear()
      },
    }
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
    this.connection = null
    this.updateHandlers.clear()
    this.toolTitles.clear()
  }
}
