// Boot watchdog (W6). The renderer crash surface can't recover a broken
// main-process self-edit — main is down. This guard catches that catastrophic
// case: every self-mod-triggered restart is "armed" with a marker recording the
// commit. Main clears the marker only once it reaches `app:setReady`. If a boot
// finds the marker STILL present (the previous restart never reached ready → it
// bricked startup), it auto-reverts that commit and relaunches. A bounded attempt
// count stops a poisoned revert from looping into its own crash cycle.
//
// Part of the protected island — dependency-free (node builtins only) so the
// agent can't break it indirectly. The git revert + relaunch themselves live in
// the main bootstrap, driven by `inspectBoot()`'s decision. See SELF-MOD-HARDENING-PLAN W6.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

interface Marker {
  commit: string
  /** ISO timestamp the restart was armed (passed in — no Date.now in tests). */
  armedAt: string
  /** How many recovery attempts (reverts) we've already made for this marker. */
  attempts: number
}

export type BootDecision =
  | { action: 'none' }
  | { action: 'revert'; commit: string; attempt: number }
  | { action: 'safe-mode'; commit: string }

export class BootWatchdog {
  constructor(
    private readonly markerPath: string,
    private readonly maxAttempts = 2,
  ) {}

  private read(): Marker | null {
    if (!existsSync(this.markerPath)) return null
    try {
      const m = JSON.parse(readFileSync(this.markerPath, 'utf8')) as Marker
      if (typeof m.commit === 'string' && typeof m.attempts === 'number') return m
    } catch {
      // Corrupt marker — treat as absent rather than wedging boot.
    }
    return null
  }

  private write(m: Marker): void {
    mkdirSync(dirname(this.markerPath), { recursive: true })
    writeFileSync(this.markerPath, JSON.stringify(m))
  }

  /** Arm a self-mod restart. Call right before relaunch. `now` is injected. */
  arm(commit: string, now: string): void {
    this.write({ commit, armedAt: now, attempts: 0 })
  }

  /** Boot reached a healthy ready state — clear the marker. */
  confirmReady(): void {
    rmSync(this.markerPath, { force: true })
  }

  /**
   * Inspect the marker at the very start of boot. If a prior self-mod restart
   * never confirmed ready, decide how to recover:
   *   - within the attempt budget → revert that commit (and record the attempt),
   *   - budget exhausted → safe-mode (don't keep reverting into a crash loop),
   *   - no marker → nothing to do.
   */
  inspectBoot(): BootDecision {
    const m = this.read()
    if (!m) return { action: 'none' }
    if (m.attempts >= this.maxAttempts) {
      return { action: 'safe-mode', commit: m.commit }
    }
    const attempt = m.attempts + 1
    this.write({ ...m, attempts: attempt })
    return { action: 'revert', commit: m.commit, attempt }
  }
}
