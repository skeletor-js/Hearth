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
}

export class HmrController {
  constructor(private readonly driver: ReloadDriver) {}

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
        this.driver.reloadWindow()
        break
      case 'process-restart':
        this.driver.restartApp()
        break
    }
    return kind
  }
}
