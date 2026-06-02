// Self-mod snapshot overlay (W1). A renderer Vite plugin that makes a
// parallel-subagent turn apply atomically: while 2+ subagents are writing, the
// main process PINS each touched module to its pre-edit baseline, so the live UI
// keeps serving coherent old code and never flickers through half-applied state.
// When the parallel phase resolves, the main process APPLIES the batch and the
// plugin swaps every pinned module to disk in one HMR pass.
//
// The Vite dev server runs in a separate process from Electron main, so they
// coordinate over a tiny dev-only HTTP endpoint (`/__hearth/self-mod`), mirroring
// Stella's `/__stella/self-mod/hmr`. Single-writer turns never pin, so the agent's
// own view_app loop sees edits immediately. See SELF-MOD-HARDENING-PLAN W1.

import type { Plugin, ViteDevServer } from 'vite'
import path from 'node:path'

const ENDPOINT = '/__hearth/self-mod'

// If a turn-end is never posted (e.g. a crash mid-turn), don't suppress reloads
// forever — auto-clear the turn flag after this long.
const TURN_AUTOCLEAR_MS = 60_000

const toPosix = (v: string): string => v.replace(/\\/g, '/')
const stripQuery = (id: string): string => id.split('?')[0]

/**
 * Pure pin/apply state — repo-relative path ↔ absolute Vite module id mapping
 * plus the pinned baselines. Extracted so the plugin logic unit-tests without a
 * running Vite server.
 */
export class OverlayState {
  /** repo-relative posix path → pinned baseline source. */
  private pins = new Map<string, string>()

  constructor(private readonly repoRoot: string) {}

  /** Pin a path to a baseline (the last coherently-visible content). */
  pin(repoRelPath: string, baseline: string): void {
    this.pins.set(toPosix(repoRelPath), baseline)
  }

  /** Drop pins for these paths. Returns the absolute module ids to reload. */
  apply(repoRelPaths: string[]): string[] {
    const ids: string[] = []
    for (const rel of repoRelPaths) {
      const key = toPosix(rel)
      if (this.pins.delete(key)) ids.push(this.idForRepoRel(key))
    }
    return ids
  }

  /** Drop pins without reloading (e.g. a cancelled run). */
  release(repoRelPaths: string[]): void {
    for (const rel of repoRelPaths) this.pins.delete(toPosix(rel))
  }

  /** The pinned baseline for an absolute module id, or null. */
  baselineForId(absId: string): string | null {
    const rel = this.toRepoRel(absId)
    return rel ? (this.pins.get(rel) ?? null) : null
  }

  isPinnedId(absId: string): boolean {
    return this.baselineForId(absId) !== null
  }

  hasPins(): boolean {
    return this.pins.size > 0
  }

  /** Absolute id (no query) → repo-relative posix, or null if outside repo. */
  toRepoRel(absId: string): string | null {
    const clean = stripQuery(absId)
    const rel = path.relative(this.repoRoot, clean)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
    return toPosix(rel)
  }

  private idForRepoRel(repoRel: string): string {
    return toPosix(path.join(this.repoRoot, repoRel))
  }
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export function selfModOverlay(repoRoot: string): Plugin {
  const state = new OverlayState(repoRoot)
  let server: ViteDevServer | null = null
  // While a self-mod turn is active, Vite's autonomous full-reload is suppressed so
  // the structural change can be applied at turn end under the morph cover (B6).
  // We drop the outgoing `full-reload` HMR message at the websocket level — this
  // catches every source (index.html, new route files, route-tree regen, change),
  // unlike handleHotUpdate which misses HTML and file-add reloads. hmr `update`
  // messages still pass through, so component edits keep hot-swapping live.
  let turnActive = false
  let turnTimer: ReturnType<typeof setTimeout> | null = null
  const setTurn = (active: boolean) => {
    turnActive = active
    if (turnTimer) clearTimeout(turnTimer)
    turnTimer = null
    if (active) turnTimer = setTimeout(() => { turnActive = false }, TURN_AUTOCLEAR_MS)
  }

  // Wrap an HMR channel's `send` so `full-reload` messages are dropped while a turn
  // is active. Idempotent. Best-effort: if the shape changes, we just don't suppress.
  const wrapChannel = (ch: { send?: (...a: unknown[]) => void; __hearthWrapped?: boolean } | undefined) => {
    if (!ch || typeof ch.send !== 'function' || ch.__hearthWrapped) return
    const orig = ch.send.bind(ch)
    ch.send = (...args: unknown[]) => {
      const msg = args[0] as { type?: string } | undefined
      if (turnActive && msg && typeof msg === 'object' && msg.type === 'full-reload') return
      return orig(...args)
    }
    ch.__hearthWrapped = true
  }

  const reload = (ids: string[]) => {
    if (!server) return
    for (const id of ids) {
      const mod = server.moduleGraph.getModuleById(id)
      if (mod) void server.reloadModule(mod)
    }
  }

  return {
    name: 'hearth:self-mod-overlay',
    apply: 'serve',

    configureServer(s) {
      server = s
      // Intercept outgoing full-reload messages so a turn can suppress them. Vite 6
      // may route through the legacy ws, the back-compat hot, or the per-environment
      // client channel — wrap whichever exist.
      const sv = s as unknown as {
        ws?: { send?: (...a: unknown[]) => void }
        hot?: { send?: (...a: unknown[]) => void }
        environments?: { client?: { hot?: { send?: (...a: unknown[]) => void } } }
      }
      wrapChannel(sv.ws)
      wrapChannel(sv.hot)
      wrapChannel(sv.environments?.client?.hot)
      s.middlewares.use(ENDPOINT, (req, res) => {
        void (async () => {
          const body = (await readJsonBody(req)) as {
            op?: string
            path?: string
            baseline?: string
            paths?: string[]
          }
          if (body.op === 'pin' && typeof body.path === 'string') {
            state.pin(body.path, body.baseline ?? '')
          } else if (body.op === 'apply' && Array.isArray(body.paths)) {
            reload(state.apply(body.paths))
          } else if (body.op === 'release' && Array.isArray(body.paths)) {
            state.release(body.paths)
          } else if (body.op === 'turn-start') {
            setTurn(true)
          } else if (body.op === 'turn-end') {
            setTurn(false)
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })()
      })
    },

    load(id) {
      const baseline = state.baselineForId(id)
      // Serve the pinned baseline instead of disk so the live UI stays coherent.
      return baseline === null ? null : baseline
    },

    handleHotUpdate(ctx) {
      // While a module is pinned, suppress its HMR — the swap happens atomically
      // on `apply`, not per write. (Turn-scoped full-reload suppression happens at
      // the websocket level in configureServer, not here.)
      if (state.isPinnedId(ctx.file)) return []
      return ctx.modules
    },
  }
}
