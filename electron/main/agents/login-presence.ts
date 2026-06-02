// Presence check for a backend's OWN stored login, used to show truthful auth
// status for the INACTIVE backend (the one without a spawned adapter) so the user
// can see both backends are usable and switch freely.
//
// COMPLIANCE.md: presence/expiry ONLY — we confirm a login exists, we never read,
// store, broker, or log the token value. None of the reads below touch a token:
// Codex's auth.json is checked by existence; Claude's `oauthAccount` is non-secret
// account metadata (the OAuth token lives in the OS keychain, untouched).

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentKind } from '../../shared/protocol.js'

export function hasStoredLogin(kind: AgentKind): boolean {
  try {
    if (kind === 'codex') {
      return existsSync(join(homedir(), '.codex', 'auth.json'))
    }
    // Claude: a credentials file on Linux/headless; on macOS the token is in the
    // Keychain and ~/.claude.json carries a non-secret `oauthAccount` marker.
    if (existsSync(join(homedir(), '.claude', '.credentials.json'))) return true
    const claudeJson = join(homedir(), '.claude.json')
    if (!existsSync(claudeJson)) return false
    const root = JSON.parse(readFileSync(claudeJson, 'utf8')) as { oauthAccount?: unknown }
    return root.oauthAccount != null
  } catch {
    return false
  }
}
