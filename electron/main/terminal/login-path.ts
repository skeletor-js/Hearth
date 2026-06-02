// GUI-launched Electron (from Finder/Dock) inherits a stunted PATH that often
// lacks the user's shell additions — so `claude`/`codex` (installed via Homebrew,
// npm-global, nvm, etc.) won't resolve in the PTY or in spawned CLI lookups.
// We resolve the user's real login PATH ONCE (a single login+interactive shell at
// first use, cached) and merge it with the inherited PATH. Spawning a login shell
// per terminal would re-source heavy rc files every time; once is enough.

import { spawnSync } from 'node:child_process'
import { platform, env } from 'node:process'
import { delimiter } from 'node:path'

let cached: string | null = null

/** The user's login PATH, resolved once and cached. Falls back to the inherited
 * PATH if resolution fails or on Windows (no login-shell concept). */
export function loginPath(): string {
  if (cached !== null) return cached
  const inherited = env.PATH ?? ''
  cached = inherited
  if (platform === 'win32') return cached
  try {
    const shell = env.SHELL || '/bin/zsh'
    // Wrap PATH in sentinels so rc-file noise (banners, prompts) can't corrupt it.
    const res = spawnSync(shell, ['-lic', 'printf "__HP__%s__HP__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
    })
    const m = res.stdout?.match(/__HP__([\s\S]*?)__HP__/)
    const resolved = m?.[1]?.trim()
    if (resolved) cached = mergePaths(resolved, inherited)
  } catch {
    /* keep the inherited PATH */
  }
  return cached
}

/** Login PATH first (richer), then any inherited entries not already present. */
function mergePaths(login: string, inherited: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of `${login}${delimiter}${inherited}`.split(delimiter)) {
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out.join(delimiter)
}

/** Process env for spawned shells/CLIs with the login PATH merged in. */
export function loginEnv(): NodeJS.ProcessEnv {
  return { ...env, PATH: loginPath() }
}

/** Whether a CLI resolves on the (merged) login PATH — drives detect-and-hint in
 * the connectors UI when `claude`/`codex` aren't installed/visible. */
export function cliResolves(name: string): boolean {
  try {
    const finder = platform === 'win32' ? 'where' : 'which'
    const res = spawnSync(finder, [name], { encoding: 'utf8', env: loginEnv(), timeout: 4000 })
    return res.status === 0 && !!res.stdout?.trim()
  } catch {
    return false
  }
}
