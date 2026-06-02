// HMR controller — applies an agent's edits to the running app at the cheapest
// reload tier the changed paths allow. Port the robust version from Stella's
// runtime/kernel/self-mod/hmr.ts (contention tracking, in-flight guards, the
// custom Vite plugin endpoint). This is the minimal v1 shape.
//
// In dev, electron-vite's Vite server already HMRs renderer edits on save — so
// for `hmr`-tier changes the controller mostly observes. The work it owns is
// escalation: telling the window to reload, or asking main to restart, when an
// edit crosses a tier boundary.

import { classifyBatch, type ReloadKind } from './path-relevance.js'

export interface ReloadDriver {
  reloadWindow(): void
  restartApp(): void
  /** Reload the window behind the morph cover (no black flash). Used for the
   *  full-reload tier when Vite serves the renderer. If absent, falls back to a
   *  plain reload. Fire-and-forget — the morph plays out asynchronously. */
  coveredReload?: () => void | Promise<void>
}

export class HmrController {
  /**
   * @param viteServed True when the renderer is served by a live Vite server
   *   (dev, and the packaged self-evolving build). In that mode Vite ALREADY
   *   reloads the page itself when a full-reload-tier file (route tree, index.html)
   *   changes on disk, so a second hard `webContents.reload()` only doubles the
   *   black flash. We skip it and let Vite's lighter reload stand. Only the static
   *   fallback (no Vite/HMR) needs the forced reload.
   */
  constructor(
    private readonly driver: ReloadDriver,
    private readonly viteServed = false,
  ) {}

  /**
   * React to a committed batch of edits. Returns the tier that was applied so
   * the caller can tell the user "reloaded" vs "restarting".
   */
  apply(changedPaths: string[]): ReloadKind {
    const kind = classifyBatch(changedPaths)
    switch (kind) {
      case 'hmr':
        // Vite already hot-swapped on file write. Nothing to do.
        break
      case 'full-reload':
        // The autonomous Vite reload is suppressed during the turn (B6), so we
        // trigger the reload here — behind the morph cover when Vite serves the
        // renderer (no black flash), or a plain reload for the static fallback.
        if (this.viteServed && this.driver.coveredReload) void this.driver.coveredReload()
        else this.driver.reloadWindow()
        break
      case 'process-restart':
        this.driver.restartApp()
        break
    }
    return kind
  }
}
