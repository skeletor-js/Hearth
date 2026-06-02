// Morph timing, shared by the overlay renderer (fade durations) and referenced by
// the controller (settle delay). Two tiers: a renderer-only reapply is quick; a
// full reload needs longer to settle before we screenshot the new UI.

export interface MorphTiming {
  /** Cover fade-in (old frame appears). */
  coverRampMs: number
  /** Old→new crossfade once the new UI is captured. */
  handoffFadeMs: number
  /** How long the controller waits after triggering the reload before capturing
   *  the new frame (gives the renderer time to re-bootstrap and paint). */
  settleDelayMs: number
}

export const RENDERER_TIER: MorphTiming = { coverRampMs: 140, handoffFadeMs: 320, settleDelayMs: 450 }
export const RELOAD_TIER: MorphTiming = { coverRampMs: 200, handoffFadeMs: 420, settleDelayMs: 1100 }
