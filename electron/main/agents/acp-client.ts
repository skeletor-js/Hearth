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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type McpServerStdio,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AgentSession, PermissionRequest, SessionUpdate } from './agent.js'
import { normalizeModels, translatePermission, translateUpdate } from './acp-translate.js'
import { createWriteBroker } from '../self-mod/write-broker.js'

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

    // W0b write-mediation: when enabled, the agent's Edit/Write tools route writes
    // THROUGH Hearth (scope guard + 3-way merge). Gated behind HEARTH_MEDIATE_WRITES.
    // SPIKE RESULT (see SELF-MOD-HARDENING-PLAN W0b): the current
    // @zed-industries/claude-agent-acp adapter does NOT route Edit/Write through the
    // client fs capability — it writes disk directly and reports diffs. So mediation
    // is inert with this adapter and stays OFF; scope enforcement instead happens at
    // the commit layer (self-mod-service), and correctness comes from the overlay +
    // git-HEAD + commits. The broker is kept, tested, and ready for a future adapter
    // that honors client fs. The diff stream is unaffected by the capability.
    const mediate = !!process.env.HEARTH_MEDIATE_WRITES
    const broker = mediate ? createWriteBroker({ repoRoot: this.cwd }) : null

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
      ...(broker
        ? {
            readTextFile: async (params: { path: string }) => ({
              content: broker.readFile(params.path) ?? '',
            }),
            writeTextFile: async (params: { path: string; content: string }) => {
              const r = await broker.writeFile(params.path, params.content)
              if (r.status === 'blocked' || r.status === 'protected' || r.status === 'conflict') {
                throw new Error(`Hearth blocked write to ${params.path}: ${r.reason}`)
              }
              return {}
            },
          }
        : {}),
    }

    this.connection = new ClientSideConnection(() => client, stream)
    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      // fs capability mirrors mediation: ON routes writes through Hearth's broker
      // (scope + merge); OFF means the agent writes directly to disk and the git
      // self-mod layer observes after (the default — see ARCHITECTURE.md).
      clientCapabilities: { fs: { readTextFile: mediate, writeTextFile: mediate } },
    })
  }

  // Give the agent the Hearth MCP tools (view_app / read_ui / click / fill /
  // eval_js) so it can see AND drive the live app. Bridges to main's loopback
  // server (URL written to .hearth/bridge-url at boot). Empty if Hearth isn't
  // serving the bridge (e.g. running headless).
  private bridgeMcpServers(): McpServerStdio[] {
    const urlFile = join(this.cwd, '.hearth', 'bridge-url')
    if (!existsSync(urlFile)) return []
    const bridgeUrl = readFileSync(urlFile, 'utf-8').trim()
    if (!bridgeUrl) return []
    return [
      {
        name: 'hearth',
        command: process.execPath, // electron-as-node (see env below)
        args: [join(this.cwd, 'electron', 'main', 'agent-tools', 'hearth-mcp-server.mjs')],
        env: [
          { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
          { name: 'HEARTH_BRIDGE_URL', value: bridgeUrl },
        ],
      },
    ]
  }

  async newSession(opts?: { cwd?: string }): Promise<AgentSession> {
    const connection = this.connection
    if (!connection) throw new Error('not connected — call connect() first')

    // The session's task cwd (the workspace) may differ from the connect-time
    // cwd (REPO_ROOT). The MCP bridge stays anchored at REPO_ROOT (this.cwd).
    const sessionCwd = opts?.cwd ?? this.cwd
    const res = await connection.newSession({ cwd: sessionCwd, mcpServers: this.bridgeMcpServers() })
    const sessionId = res.sessionId
    const models = normalizeModels(res.models)

    return {
      id: sessionId,
      models,
      prompt: async (text: string) => {
        const { stopReason } = await connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text }],
        })
        this.emit(sessionId, { type: 'end', stopReason })
      },
      setModel: async (modelId: string) => {
        // unstable_* in the SDK; a no-op on backends that don't implement it.
        await connection.unstable_setSessionModel?.({ sessionId, modelId })
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
