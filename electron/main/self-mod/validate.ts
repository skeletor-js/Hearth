// Validation gate (W5/W6). Runs the project's typecheck after a self-mod and
// reports the result. Two modes:
//   - async (W5): fire-and-forget after a renderer (src/**) edit; a failure is
//     surfaced (banner / crash surface) but never blocks the turn.
//   - blocking (W6): awaited before a process-restart-tier apply; if it fails we
//     refuse the restart so a broken main edit can't brick boot.
//
// Part of the protected island; depends only on node builtins. See SELF-MOD-HARDENING-PLAN.

import { execFile } from 'node:child_process'

export interface TypecheckResult {
  ok: boolean
  /** Combined stdout+stderr (truncated) when it failed, for the surface/repair prompt. */
  output: string
}

/** Run `bun run typecheck` in the repo. Resolves with ok=false on type errors. */
export function runTypecheck(repoRoot: string, timeoutMs = 120_000): Promise<TypecheckResult> {
  return new Promise((resolve) => {
    execFile(
      'bun',
      ['run', 'typecheck'],
      { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim()
        resolve({ ok: !err, output: err ? out.slice(0, 8000) : '' })
      },
    )
  })
}
