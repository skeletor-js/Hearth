// Main-process client for the renderer overlay plugin's dev endpoint (W1). Posts
// pin/apply/release to the Vite dev server (a separate process), best-effort: the
// overlay is a dev-only optimization, so a failed POST (production build, server
// not up) is swallowed — correctness still comes from the git-HEAD path + commits.
//
// Part of the protected island; depends only on node builtins. See SELF-MOD-HARDENING-PLAN W1.

const ENDPOINT = '/__hearth/self-mod'

async function post(devUrl: string | null, body: unknown): Promise<void> {
  if (!devUrl) return
  try {
    await fetch(new URL(ENDPOINT, devUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Best-effort: overlay is a dev-only optimization.
  }
}

export interface OverlayClient {
  pin(repoRelPath: string, baseline: string): Promise<void>
  apply(repoRelPaths: string[]): Promise<void>
  release(repoRelPaths: string[]): Promise<void>
  /** Mark a self-mod turn active/inactive. While active, the overlay plugin
   *  suppresses Vite's autonomous full-reload for full-reload-tier files so a
   *  structural edit can be applied under the morph cover at turn end (B6). */
  turnStart(): Promise<void>
  turnEnd(): Promise<void>
}

export function createOverlayClient(getDevUrl: () => string | null): OverlayClient {
  return {
    pin: (path, baseline) => post(getDevUrl(), { op: 'pin', path, baseline }),
    apply: (paths) => post(getDevUrl(), { op: 'apply', paths }),
    release: (paths) => post(getDevUrl(), { op: 'release', paths }),
    turnStart: () => post(getDevUrl(), { op: 'turn-start' }),
    turnEnd: () => post(getDevUrl(), { op: 'turn-end' }),
  }
}
