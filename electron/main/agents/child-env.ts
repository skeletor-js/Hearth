// Builds the environment for a spawned ACP adapter subprocess.
//
// Normally the adapter inherits Hearth's full process.env and we merge a little
// extra over it (ELECTRON_RUN_AS_NODE, a BYO API key). But when Hearth runs
// *inside another agent* (e.g. a Claude Code dev shell), that parent leaks its own
// ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL into our env — and the spawned agent
// picks them up and talks to the wrong gateway, which rejects the turn. That's the
// documented reason a live model turn couldn't be verified from inside the sandbox
// (see docs/acp memory). HEARTH_SCRUB_INHERITED_KEYS=1 strips those inherited
// credential/gateway vars so the spawned agent uses ONLY the credential Hearth
// chose (the user's login, or the BYO key in `extra`).
//
// Scrubbing happens on the INHERITED env only; `extra` (which carries the user's
// own BYO key) is merged AFTER the scrub, so it always wins. That makes the flag
// safe in both auth modes: subscription (nothing injected → agent uses its login)
// and api-key (the BYO key in `extra` re-supplies the credential).

/** Inherited env vars that, if leaked from a parent agent, hijack the spawned
 * adapter's credential or gateway. Scrubbed only when the flag is set. */
export const INHERITED_CREDENTIAL_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const

export interface BuildChildEnvOptions {
  /** When true, drop INHERITED_CREDENTIAL_VARS from the base env before merging. */
  scrubInheritedKeys?: boolean
}

/**
 * Compose the child env: base (usually process.env), optionally scrubbed, with
 * `extra` merged over the top. Pure so the scrub logic unit-tests without a spawn.
 */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
  opts: BuildChildEnvOptions = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base }
  if (opts.scrubInheritedKeys) {
    for (const key of INHERITED_CREDENTIAL_VARS) delete out[key]
  }
  return { ...out, ...extra }
}

/** Read the opt-in flag from an env (defaults to process.env). */
export function shouldScrubInheritedKeys(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HEARTH_SCRUB_INHERITED_KEYS === '1'
}
