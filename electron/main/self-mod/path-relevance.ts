// Classify a changed repo-relative path into the cheapest reload it needs.
// Ported (simplified) from Stella's runtime/kernel/self-mod/path-relevance.ts.
//
//   hmr           — renderer source; Vite hot-swaps it, state preserved
//   full-reload   — route tree / html / styles entry; reload the window
//   process-restart — main/preload/electron config; restart the app
//
// The agent edits mostly land in `hmr`. The escalation tiers exist so a deeper
// edit doesn't silently fail to take effect.

export type ReloadKind = 'hmr' | 'full-reload' | 'process-restart'

const PROCESS_RESTART_PREFIXES = ['electron/main/', 'electron/preload/']
const PROCESS_RESTART_FILES = ['electron.vite.config.ts', 'package.json', 'tsconfig.json']

const FULL_RELOAD_EXACT = ['index.html', 'src/routeTree.gen.ts']
const FULL_RELOAD_PREFIXES = ['src/routes/'] // route files regenerate the tree

export function classifyPath(repoRelPath: string): ReloadKind {
  const p = repoRelPath.replace(/\\/g, '/')

  if (PROCESS_RESTART_FILES.includes(p)) return 'process-restart'
  if (PROCESS_RESTART_PREFIXES.some((pre) => p.startsWith(pre))) return 'process-restart'

  if (FULL_RELOAD_EXACT.includes(p)) return 'full-reload'
  if (FULL_RELOAD_PREFIXES.some((pre) => p.startsWith(pre))) return 'full-reload'

  // Everything else under the renderer hot-swaps.
  if (p.startsWith('src/')) return 'hmr'

  // Unknown (docs, scripts, micro-apps) — no shell reload needed.
  return 'hmr'
}

/**
 * True for paths the Vite dev server serves to the renderer and the self-mod
 * overlay (W1) can therefore pin to a baseline and swap atomically. Narrower than
 * the reload classifier: the overlay can't make main-process code, configs, or
 * package installs visible — those go through HmrController's restart tiers.
 */
export function isViteTrackablePath(repoRelPath: string): boolean {
  const p = repoRelPath.replace(/\\/g, '/')
  return p.startsWith('src/') || p === 'index.html'
}

/** The strongest reload required by a batch of edits. */
export function classifyBatch(paths: string[]): ReloadKind {
  let strongest: ReloadKind = 'hmr'
  for (const path of paths) {
    const kind = classifyPath(path)
    if (kind === 'process-restart') return 'process-restart'
    if (kind === 'full-reload') strongest = 'full-reload'
  }
  return strongest
}
