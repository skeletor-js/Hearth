// Resolves the credential mode for a backend. A stored BYO API key (in the
// encrypted secret store) wins; otherwise the matching env var; otherwise
// subscription — the adapter reads the user's existing `claude login` /
// `codex login`. We never originate or store a subscription token. See
// docs/COMPLIANCE.md.

import type { AgentKind } from '../../shared/protocol.js'
import type { AgentAuth } from './agent.js'
import type { SecretStore } from '../secrets/secret-store.js'

/** The secret-store key + env-var fallback that hold a backend's BYO API key. */
export function apiKeyRefs(kind: AgentKind): { secretKey: string; envVar: string } {
  return kind === 'codex'
    ? { secretKey: 'apikey.openai', envVar: 'OPENAI_API_KEY' }
    : { secretKey: 'apikey.anthropic', envVar: 'ANTHROPIC_API_KEY' }
}

/** Resolve the auth for a backend: stored key → env key → subscription. */
export function resolveAuth(kind: AgentKind, secrets: Pick<SecretStore, 'get'>): AgentAuth {
  const { secretKey, envVar } = apiKeyRefs(kind)
  const stored = secrets.get(secretKey)
  if (stored) return { mode: 'api-key', key: stored, source: 'secret' }
  const env = process.env[envVar]
  if (env) return { mode: 'api-key', key: env, source: 'env' }
  return { mode: 'subscription' }
}
