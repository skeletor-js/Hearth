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
  type McpServer,
  type McpServerStdio,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AgentSession, AuthMethodInfo, AvailableCommand, PermissionRequest, PromptCapabilities, PromptImage, SessionUpdate } from './agent.js'
import { normalizeConfigOptions, normalizeModels, normalizeModes, translatePermission, translateUpdate } from './acp-translate.js'
import { buildChildEnv, shouldScrubInheritedKeys } from './child-env.js'

export interface AdapterSpec {
  /** Executable + args that launch the ACP adapter, e.g. the claude-agent-acp bin. */
  command: string
  args: string[]
  cwd: string
  /** Extra env merged over process.env (never inject secrets here — see COMPLIANCE.md). */
  env?: Record<string, string>
}

// Update kinds that are chat transcript content (suppressed during loadSession
// replay, since Hearth renders the transcript from its own store).
const CHAT_CONTENT_UPDATES = new Set<SessionUpdate['type']>(['message', 'thought', 'tool-call', 'diff', 'plan', 'end'])

export type UpdateHandler = (sessionId: string, update: SessionUpdate) => void
export type PermissionHandler = (sessionId: string, req: PermissionRequest) => Promise<string>
/** Supplies the user's configured MCP servers, resolved (secrets injected) at
 * session-creation time so tokens never sit in a config file. */
export type McpServerProvider = () => Promise<McpServer[]>

export class AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private connection: ClientSideConnection | null = null
  private cwd = process.cwd()
  private updateHandlers = new Set<UpdateHandler>()
  private permissionHandler: PermissionHandler | null = null
  // tool-call id -> title, so tool_call_update notifications (which omit the
  // title) can be displayed with a name. See acp-translate.translateUpdate.
  private toolTitles = new Map<string, string>()
  // Auth methods the adapter advertised at initialize, and the slash commands /
  // skills it has surfaced this connection. Both feed Settings (auth + skills).
  private authMethodsList: AuthMethodInfo[] = []
  private commands: AvailableCommand[] = []
  // Prompt input the adapter accepts beyond text (image / embedded context),
  // captured from initialize. Defaults to text-only until proven otherwise.
  private promptCaps: PromptCapabilities = { image: false, embeddedContext: false }
  // ACP session ids currently replaying prior history via loadSession(). Chat-
  // content updates for THESE sessions are dropped (Hearth's store already renders
  // the transcript); config/mode/usage/commands still flow. Scoped per session so a
  // concurrent live session on the same connection doesn't lose its updates.
  private replayingSessions = new Set<string>()

  // A factory, not a resolved spec: resolution (which can throw — missing bin,
  // missing API key) is deferred to connect() so it fails through the connect
  // rejection path rather than at construction time. `userMcpServers` supplies
  // the user's configured MCP servers to merge into each new session.
  constructor(
    private readonly resolveSpec: () => AdapterSpec,
    private readonly userMcpServers?: McpServerProvider,
  ) {}

  async connect(): Promise<void> {
    const spec = this.resolveSpec()
    this.cwd = spec.cwd
    // Merge spec.env over our env. When HEARTH_SCRUB_INHERITED_KEYS=1, strip the
    // credential/gateway vars a parent agent may have leaked first, so the spawned
    // adapter uses only the credential Hearth chose (login, or the BYO key in
    // spec.env which is merged after the scrub). See child-env.ts.
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: buildChildEnv(process.env, spec.env, { scrubInheritedKeys: shouldScrubInheritedKeys() }),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group so dispose() can kill the adapter AND its grandchildren
      // (the claude/codex CLI + the MCP servers it spawns), not just the adapter.
      detached: true,
    })
    this.child = child

    // If the adapter dies (crash, or we killed it), null the connection so the next
    // call fails fast with a clear "not connected" instead of rejecting deep in the
    // SDK against a dead pipe.
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null
        this.connection = null
      }
      if (code) console.error(`[acp adapter] exited with code ${code}${signal ? ` (${signal})` : ''}`)
    })

    // Surface adapter stderr to our log; it's where the agent reports its own
    // startup/auth failures.
    child.stderr.on('data', (b: Buffer) => process.stderr.write(`[acp adapter] ${b}`))

    // ndJsonStream(output, input): output is the writable we send to (the
    // adapter's stdin), input is the readable we receive on (its stdout).
    const toAgent = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
    const fromAgent = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    const stream = ndJsonStream(toAgent, fromAgent)

    // Hearth does NOT route the agent's Edit/Write through the ACP client fs
    // capability: the current @zed-industries/claude-agent-acp adapter writes disk
    // directly and reports diffs, so a client-side write broker would be inert (see
    // SELF-MOD-HARDENING-PLAN W0b). Scope enforcement happens at the commit layer
    // (self-mod-service), with correctness from the overlay + git-HEAD + commits.
    const client: Client = {
      sessionUpdate: async (params: SessionNotification) => {
        for (const update of translateUpdate(params.update, this.toolTitles)) {
          // The agent's advertised slash commands / skills: cache for getters, and
          // also forward so the host can fire its commands-changed event (the chat
          // surface ignores this update type). Not streamed into the transcript.
          if (update.type === 'commands') this.commands = update.commands
          // During a loadSession replay, drop chat-content updates (the transcript
          // is already on screen from Hearth's store); let session-state updates pass.
          // Keyed by session id so only the replaying session is suppressed.
          if (this.replayingSessions.has(params.sessionId) && CHAT_CONTENT_UPDATES.has(update.type)) continue
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
    const init = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      // No client fs capability: the agent writes directly to disk and the git
      // self-mod layer observes after (see ARCHITECTURE.md).
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    })
    // The initialize response advertises which auth methods the adapter supports
    // (env-var / terminal login). Captured for Settings → Auth; we never act on it
    // automatically (no OAuth rendered — see docs/COMPLIANCE.md).
    this.authMethodsList = (init?.authMethods ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? undefined,
    }))
    // Prompt capabilities (image / embedded context) — drives composer affordances.
    const pc = init?.agentCapabilities?.promptCapabilities
    this.promptCaps = { image: !!pc?.image, embeddedContext: !!pc?.embeddedContext }
  }

  /** Auth methods the adapter advertised at initialize (empty before connect). */
  authMethods(): AuthMethodInfo[] {
    return this.authMethodsList
  }

  /** Prompt capabilities the adapter advertised at initialize. */
  promptCapabilities(): PromptCapabilities {
    return this.promptCaps
  }

  /** Slash commands / skills the agent has advertised this connection. */
  advertisedCommands(): AvailableCommand[] {
    return this.commands
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
    const tokenFile = join(this.cwd, '.hearth', 'bridge-token')
    const bridgeToken = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf-8').trim() : ''
    return [
      {
        name: 'hearth',
        command: process.execPath, // electron-as-node (see env below)
        args: [join(this.cwd, 'electron', 'main', 'agent-tools', 'hearth-mcp-server.mjs')],
        env: [
          { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
          { name: 'HEARTH_BRIDGE_URL', value: bridgeUrl },
          { name: 'HEARTH_BRIDGE_TOKEN', value: bridgeToken },
        ],
      },
    ]
  }

  // Built-in bridge + the user's configured servers (secrets resolved here, at
  // session creation, so tokens never sit in a config file).
  private async mcpServersFor(): Promise<McpServer[]> {
    const userServers = this.userMcpServers ? await this.userMcpServers().catch(() => []) : []
    return [...this.bridgeMcpServers(), ...userServers]
  }

  async newSession(opts?: { cwd?: string }): Promise<AgentSession> {
    const connection = this.connection
    if (!connection) throw new Error('not connected — call connect() first')
    // The session's task cwd (the workspace) may differ from the connect-time
    // cwd (REPO_ROOT). The MCP bridge stays anchored at REPO_ROOT (this.cwd).
    const sessionCwd = opts?.cwd ?? this.cwd
    const res = await connection.newSession({ cwd: sessionCwd, mcpServers: await this.mcpServersFor() })
    return this.buildSession(res.sessionId, res)
  }

  async resumeSession(acpSessionId: string, opts?: { cwd?: string }): Promise<AgentSession> {
    const connection = this.connection
    if (!connection) throw new Error('not connected — call connect() first')
    if (!connection.loadSession) throw new Error('backend does not support loadSession')
    const sessionCwd = opts?.cwd ?? this.cwd
    // loadSession replays the prior conversation as session/update notifications so
    // the AGENT regains context. Hearth already renders the transcript from its own
    // store, so suppress those replayed chat updates (config/mode/usage/commands
    // still flow). The RPC resolves only after the adapter finishes replaying, so
    // this flag brackets exactly the replay notifications.
    this.replayingSessions.add(acpSessionId)
    try {
      const res = await connection.loadSession({ sessionId: acpSessionId, cwd: sessionCwd, mcpServers: await this.mcpServersFor() })
      return this.buildSession(acpSessionId, res)
    } finally {
      this.replayingSessions.delete(acpSessionId)
    }
  }

  /** Build the backend-agnostic AgentSession over an ACP session id + its initial
   * state (newSession and loadSession return the same model/mode/config shape). */
  private buildSession(sessionId: string, res: { models?: unknown; modes?: unknown; configOptions?: unknown }): AgentSession {
    const connection = this.connection
    if (!connection) throw new Error('not connected')
    return {
      id: sessionId,
      models: normalizeModels(res.models as Parameters<typeof normalizeModels>[0]),
      modes: normalizeModes(res.modes as Parameters<typeof normalizeModes>[0]),
      configOptions: normalizeConfigOptions(res.configOptions as Parameters<typeof normalizeConfigOptions>[0]),
      prompt: async (text: string, images?: PromptImage[]) => {
        // text + any image blocks the backend advertised support for. Gate here too
        // (defense in depth): never send an image to a backend that didn't advertise
        // promptCapabilities.image.
        const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
          { type: 'text', text },
        ]
        if (this.promptCaps.image && images?.length) {
          for (const img of images) blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType })
        }
        const { stopReason } = await connection.prompt({ sessionId, prompt: blocks })
        this.emit(sessionId, { type: 'end', stopReason })
      },
      setModel: async (modelId: string) => {
        // unstable_* in the SDK; a no-op on backends that don't implement it.
        await connection.unstable_setSessionModel?.({ sessionId, modelId })
      },
      setMode: async (modeId: string) => {
        // Stable in the SDK; both adapters implement it. No-op if absent.
        await connection.setSessionMode?.({ sessionId, modeId })
      },
      setConfigOption: async (configId: string, value: string | boolean) => {
        // Stable in the SDK. The request is a discriminated union: boolean options
        // carry `{ type:'boolean', value }`, selects carry `{ value: <valueId> }`.
        const params =
          typeof value === 'boolean'
            ? { sessionId, configId, type: 'boolean' as const, value }
            : { sessionId, configId, value }
        await connection.setSessionConfigOption?.(params)
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
    const child = this.child
    this.child = null
    this.connection = null
    this.updateHandlers.clear()
    this.toolTitles.clear()
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    killTree(child, 'SIGTERM')
    // Escalate if it ignores SIGTERM, so a wedged adapter can't leak.
    const timer = setTimeout(() => killTree(child, 'SIGKILL'), 2000)
    if (typeof timer.unref === 'function') timer.unref()
    child.once('exit', () => clearTimeout(timer))
  }
}

/** Kill the adapter's whole process group (it was spawned detached), falling back
 * to a direct kill if the group send fails (e.g. pid already reaped). */
function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // group gone or unsupported — fall through to a direct kill
  }
  try {
    child.kill(signal)
  } catch {
    // already gone
  }
}
