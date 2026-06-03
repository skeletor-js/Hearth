// Scope guard for agent writes (W7). Splits every write target into three tiers:
//
//   blocked   — never writable: system dirs, credentials/secrets, Hearth internal
//               state, device files. Ported from Stella's `isBlockedPath`.
//   protected — the safety-net island: the self-mod engine, boot watchdog, recovery
//               anchor, and the managed `.claude` hook config. Editable by the agent
//               only with explicit user approval, so it can't silently disarm its
//               own guardrails even though the rest of main is editable.
//   canvas    — everything else (the agent's free surface), including the rest of
//               electron/main, preload, configs, deps, src/**, skills, prompts.
//
// This module is part of the protected island itself and MUST stay dependency-free
// (node builtins only) so the agent can never break it indirectly by editing a
// transitive import. See docs/completed-plans/SELF-MOD-HARDENING-PLAN.md (W7).

import path from 'node:path'
import os from 'node:os'

export type ScopeTier = 'blocked' | 'protected' | 'canvas'

export interface ScopeDecision {
  tier: ScopeTier
  /** Human-readable reason, present for `blocked`/`protected`. */
  reason?: string
}

// Absolute system directory prefixes that are never writable (port of Stella's set).
const BLOCKED_SYSTEM_PREFIXES: string[] = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/sys',
  '/proc',
  '/private/etc',
  '/private/var',
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.kube'),
  path.join(os.homedir(), '.docker'),
  path.join(os.homedir(), '.azure'),
  path.join(os.homedir(), '.config', 'gh'),
  path.join(os.homedir(), '.config', 'gcloud'),
]

// Credential / shell-init files in the user's home that must never be written.
const SENSITIVE_HOME_FILES = [
  '.zshrc',
  '.bashrc',
  '.bash_profile',
  '.zprofile',
  '.profile',
  '.netrc',
  '.pgpass',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
]

// Repo-relative files that hold secrets or Hearth internal runtime state. Note
// `.hearth/personality.json` and `.hearth/memory.md` are NOT here — those are the
// agent's soul/memory canvas. Only non-editable runtime artifacts are blocked.
const BLOCKED_REPO_FILES = new Set<string>([
  '.env',
  '.git-credentials',
  'auth.json',
  '.hearth/bridge-url',
  '.hearth/.vite-dev-url',
  '.hearth/snapshot.png',
])

// Repo-relative prefixes for the protected safety-net island.
const PROTECTED_REPO_PREFIXES: string[] = [
  'electron/main/self-mod/',
  '.claude/',
]

const toPosix = (value: string): string => value.replace(/\\/g, '/')

// Case-fold is deliberate: macOS (the target platform) uses a case-insensitive
// filesystem, so `SRC/secret` and `src/secret` are the SAME file — matching must
// be case-insensitive or a case-variant path would bypass a protected prefix. On a
// case-sensitive volume this only ever over-protects (fail-safe), never under-.
const normalizeAbs = (filePath: string): string => {
  const expanded = filePath.startsWith('~')
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath
  return toPosix(path.resolve(expanded)).toLowerCase()
}

const matchesPrefix = (normalized: string, prefix: string): boolean => {
  const p = toPosix(path.resolve(prefix)).toLowerCase().replace(/\/+$/u, '')
  return normalized === p || normalized.startsWith(`${p}/`)
}

const isBlockedDevice = (normalized: string): boolean =>
  normalized === '/dev/null' ||
  normalized === '/dev/zero' ||
  normalized === '/dev/random' ||
  normalized === '/dev/urandom' ||
  normalized.startsWith('/dev/') ||
  /^\/proc\/\d+\/fd\/[0-2]$/u.test(normalized)

const isSensitiveHomePath = (normalized: string): boolean =>
  SENSITIVE_HOME_FILES.some(
    (rel) => normalized === normalizeAbs(path.join(os.homedir(), rel)),
  )

/**
 * Repo-relative posix path if `absPath` is inside `repoRoot`, else null.
 */
const toRepoRelative = (absPath: string, repoRoot: string): string | null => {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(absPath))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return toPosix(rel)
}

/**
 * Classify a write target. `absPath` may be absolute or repo-relative; if
 * repo-relative it is resolved against `repoRoot`. System/secret checks run on
 * the absolute form; island/canvas checks run on the repo-relative form.
 */
export const classifyWrite = (
  rawPath: string,
  repoRoot: string,
): ScopeDecision => {
  const absPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(repoRoot, rawPath)
  const normalized = normalizeAbs(absPath)

  if (isBlockedDevice(normalized)) {
    return { tier: 'blocked', reason: 'device files are not writable' }
  }
  if (isSensitiveHomePath(normalized)) {
    return { tier: 'blocked', reason: 'credential / shell-init files are not writable' }
  }
  for (const prefix of BLOCKED_SYSTEM_PREFIXES) {
    if (matchesPrefix(normalized, prefix)) {
      return { tier: 'blocked', reason: 'system directories are not writable' }
    }
  }

  const rel = toRepoRelative(absPath, repoRoot)
  // Writes outside the repo (e.g. a user workspace) aren't self-mod; allow them
  // once the system/secret guards above have passed.
  if (rel === null) return { tier: 'canvas' }

  if (rel.startsWith('.git/') || rel === '.git') {
    return { tier: 'blocked', reason: 'the git internal dir is not writable' }
  }
  if (BLOCKED_REPO_FILES.has(rel) || rel.startsWith('.env.')) {
    return { tier: 'blocked', reason: 'secrets / internal state are not writable' }
  }
  for (const prefix of PROTECTED_REPO_PREFIXES) {
    if (rel === prefix.replace(/\/$/u, '') || rel.startsWith(prefix)) {
      return {
        tier: 'protected',
        reason: 'safety-net island — requires explicit approval',
      }
    }
  }
  return { tier: 'canvas' }
}

/** Convenience: true when the path may be written without approval. */
export const isCanvasPath = (rawPath: string, repoRoot: string): boolean =>
  classifyWrite(rawPath, repoRoot).tier === 'canvas'
