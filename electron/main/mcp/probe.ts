// "Test" for a configured MCP server: launch it and run the MCP handshake so
// the user learns it works (and how many tools it exposes) BEFORE a real session
// depends on it. stdio runs a full initialize + tools/list over the process's
// stdio (newline-delimited JSON-RPC). http/sse do a reachability check (a full
// streamable-HTTP handshake is out of scope for v1 — we report reachable, not a
// tool count, and say so honestly).

import { spawn } from 'node:child_process'
import { toAcpServers } from './to-acp.js'
import type { McpServerConfig } from './registry.js'

type SecretLookup = { get(key: string): string | undefined }

export interface ProbeResult {
  ok: boolean
  /** Number of tools the server advertised (stdio only). */
  tools?: number
  /** True when we verified reachability but not a tool count (http/sse). */
  reachableOnly?: boolean
  error?: string
}

const PROBE_TIMEOUT_MS = 8000

export async function probeServer(config: McpServerConfig, secrets: SecretLookup): Promise<ProbeResult> {
  const { servers, skipped } = toAcpServers([{ ...config, enabled: true }], secrets)
  if (skipped.length) return { ok: false, error: `Missing secret(s): ${skipped[0].missing.join(', ')}` }
  const server = servers[0]
  if (!server) return { ok: false, error: 'Server is disabled or misconfigured' }

  if ('command' in server) return probeStdio(server.command, server.args, server.env)
  return probeHttp(server.url, server.headers)
}

function probeStdio(
  command: string,
  args: string[],
  env: { name: string; value: string }[],
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    const finish = (r: ProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      resolve(r)
    }

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...Object.fromEntries(env.map((e) => [e.name, e.value])) },
    })

    const timer = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for the server' }), PROBE_TIMEOUT_MS)
    child.on('error', (e) => finish({ ok: false, error: e.message }))
    child.on('exit', (code) => finish({ ok: false, error: `Server exited (code ${code ?? 'unknown'}) before responding` }))

    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n')

    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: { id?: unknown; result?: { tools?: unknown[] }; error?: { message?: string } }
        try {
          msg = JSON.parse(line)
        } catch {
          continue // server log noise, not a JSON-RPC frame
        }
        if (msg.id === 1) {
          // A JSON-RPC error to initialize (bad protocol version, auth, etc.) is a
          // real answer — report it instead of hanging until the timeout.
          if (msg.error) {
            finish({ ok: false, error: msg.error.message || 'initialize failed' })
          } else if (msg.result) {
            // initialize ok → ack, then ask for the tool list.
            send({ jsonrpc: '2.0', method: 'notifications/initialized' })
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
          }
        } else if (msg.id === 2) {
          if (msg.error) {
            finish({ ok: false, error: msg.error.message || 'tools/list failed' })
          } else {
            const tools = Array.isArray(msg.result?.tools) ? msg.result!.tools!.length : 0
            finish({ ok: true, tools })
          }
        }
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hearth', version: '1' },
      },
    })
  })
}

async function probeHttp(url: string, headers: { name: string; value: string }[]): Promise<ProbeResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...Object.fromEntries(headers.map((h) => [h.name, h.value])),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hearth', version: '1' } },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    // Any HTTP response (even 4xx) means the endpoint is reachable; a network
    // failure throws. We don't parse the MCP body for http/sse in v1.
    if (res.ok || res.status < 500) return { ok: true, reachableOnly: true }
    return { ok: false, error: `Server responded ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
