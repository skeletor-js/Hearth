// User-configured MCP servers. Persisted as plain config under userData; the
// secret values these servers need live in the encrypted secret store and are
// referenced here by key (never copied in). The registry is merged into every
// new ACP session (see acp-client.newSession) alongside the built-in `hearth`
// bridge.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** One env var (stdio) or header (http/sse) the server needs. Either a literal
 * value or a reference into the secret store — never both meaningfully set. */
export interface McpEnvVar {
  name: string
  /** Resolve from the secret store at session-creation time. */
  secretKey?: string
  /** A literal value (stored in this config file as-is). */
  value?: string
}

export type McpTransport =
  | { type: 'stdio'; command: string; args: string[] }
  | { type: 'http'; url: string }
  | { type: 'sse'; url: string }

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: McpTransport
  /** Env vars (stdio) or HTTP headers (http/sse). */
  env: McpEnvVar[]
}

/** A new server before it gets an id. */
export type McpServerInput = Omit<McpServerConfig, 'id'>

export class McpRegistry {
  private servers: McpServerConfig[] = []

  constructor(private readonly filePath: string) {
    this.load()
  }

  list(): McpServerConfig[] {
    return this.servers.map((s) => ({ ...s, env: s.env.map((e) => ({ ...e })) }))
  }

  add(input: McpServerInput): McpServerConfig {
    const server: McpServerConfig = { ...input, id: randomUUID() }
    this.servers.push(server)
    this.persist()
    return server
  }

  update(id: string, patch: Partial<McpServerInput>): McpServerConfig | null {
    const i = this.servers.findIndex((s) => s.id === id)
    if (i === -1) return null
    this.servers[i] = { ...this.servers[i], ...patch, id }
    this.persist()
    return this.servers[i]
  }

  setEnabled(id: string, enabled: boolean): void {
    const s = this.servers.find((s) => s.id === id)
    if (s && s.enabled !== enabled) {
      s.enabled = enabled
      this.persist()
    }
  }

  remove(id: string): void {
    const before = this.servers.length
    this.servers = this.servers.filter((s) => s.id !== id)
    if (this.servers.length !== before) this.persist()
  }

  get(id: string): McpServerConfig | undefined {
    return this.servers.find((s) => s.id === id)
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as McpServerConfig[]
      if (Array.isArray(parsed)) this.servers = parsed
    } catch {
      this.servers = []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.servers, null, 2) + '\n')
  }
}
