// Maps Hearth's MCP server configs into the ACP SDK's McpServer wire shape,
// resolving secret references against the secret store. Pure (the store is passed
// in) so it's unit-testable. Disabled servers and servers with unresolved secrets
// are dropped — a half-configured server should not silently launch without its
// credentials.

import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig, McpEnvVar } from './registry.js'

type SecretLookup = { get(key: string): string | undefined }

/** Resolve one env var/header to a concrete value, or null if a secret is missing. */
function resolveVar(v: McpEnvVar, secrets: SecretLookup): { name: string; value: string } | null {
  if (v.secretKey) {
    const value = secrets.get(v.secretKey)
    return value === undefined ? null : { name: v.name, value }
  }
  return { name: v.name, value: v.value ?? '' }
}

export interface ToAcpResult {
  servers: McpServer[]
  /** Enabled servers skipped because a referenced secret was missing. */
  skipped: { name: string; missing: string[] }[]
}

export function toAcpServers(configs: McpServerConfig[], secrets: SecretLookup): ToAcpResult {
  const servers: McpServer[] = []
  const skipped: { name: string; missing: string[] }[] = []

  for (const cfg of configs) {
    if (!cfg.enabled) continue
    const resolved = cfg.env.map((v) => ({ v, r: resolveVar(v, secrets) }))
    const missing = resolved.filter((x) => x.r === null).map((x) => x.v.secretKey ?? x.v.name)
    if (missing.length) {
      skipped.push({ name: cfg.name, missing })
      continue
    }
    const vars = resolved.map((x) => x.r as { name: string; value: string })

    if (cfg.transport.type === 'stdio') {
      servers.push({
        name: cfg.name,
        command: cfg.transport.command,
        args: cfg.transport.args,
        env: vars,
      })
    } else {
      // http/sse: the env vars are sent as HTTP headers.
      servers.push({
        type: cfg.transport.type,
        name: cfg.name,
        url: cfg.transport.url,
        headers: vars,
      })
    }
  }

  return { servers, skipped }
}
