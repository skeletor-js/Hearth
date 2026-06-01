# Hearth UI — Implementation Plan (for `/goal`)

Paste the block below into `/goal`. It drives a follow-up agent to implement the fixes
in [`docs/ui-review.md`](./ui-review.md). The review doc is the granular spec (every
finding has file + selector + line + `current → proposed` + token); this plan locks the
decisions, sequencing, verification bar, and guardrails.

---

```
Implement the fixes in docs/ui-review.md across the live Hearth app. That doc is the
authoritative spec: every finding (F1–F23, S1–S6) has a severity, the exact component
file + selector + line, and a current → proposed change with real values/tokens. Apply
them — do not re-derive the analysis, and do not write another review. Code changes only.

## Locked decisions
- Scope: ALL findings, in phase order P1 → P2 → P3 → P4 (see the doc's "Phased plan").
- Hero (F16/F17): in src/routes/new.tsx, adopt the design system's EXISTING `.hero` /
  `.hero-grid` CSS and delete the ad-hoc inline layout; ADD a 4th starter card so the
  grid is a clean 2×2. Do NOT delete `.hero`/`.hero-grid` — it becomes the source of truth.
- Do NOT touch CrashSurface.tsx hardcoded px/hex (intentional — it renders without the
  design system). Do NOT "fix" TerminalTab hex (they're fallbacks behind getComputedStyle).
- The hex/values proposed in the doc are STARTING POINTS. The real bar is the measured
  one: F2/F3/S6 must actually meet WCAG AA in BOTH themes. Adjust to pass while keeping
  the warm hue family.

## How to work
- Renderer only (src/**). The dev server hot-reloads, so edits land live. Do NOT edit
  electron/main/** or electron/preload/** (they restart the app) — no finding lives there.
- No new dependencies, frameworks, or abstractions. Match existing patterns: shared
  primitives in src/app/settings/controls.tsx, `.btn`/`.chip` and tokens in
  src/styles/hearth.css. For the systemic findings (S1 mono token, S2 off-scale-font
  sweep, S3 radius scale, S4 shared hover-transition + Seg-with-icons + <SecLabel> +
  .chip-sm, S5 dead-CSS removal), add the token/primitive ONCE and route call sites to
  it — don't patch each inline copy.

## Verify each phase at full rigor BEFORE committing it
- `bun run typecheck`, `bun run lint`, `bun run build`, and `bun test` must pass.
- Drive the LIVE app to confirm visually (this repo IS the running app). Use the loopback
  bridge: read the base URL from .hearth/bridge-url, then `POST /eval {code}` to drive and
  read computed styles, and `GET /snapshot[?path=/route]` for PNGs. If the app isn't
  running, start it with `bun dev`. (The in-app `hearth` MCP tools belong to the in-app
  agent, not you — use the bridge, or computer-use if available.) Capture BEFORE and AFTER
  screenshots of every changed surface in BOTH light and dark.
- Color findings (F2, F3, S6): via /eval, compute the WCAG ratio of --subtle / --faint /
  --accent(-text) against --bg / --bg-panel / --bg-inset in BOTH themes; confirm each now
  meets its target (≥4.5:1 for the small text using --subtle and for --accent-text).
  Record the final numbers.
- F1/F1b: confirm the new --hover delta is actually visible and that hover transitions
  exist. F8: confirm the composer grows with multi-line input, then caps (~200px) and
  scrolls. F11: confirm GitPanel inputs now match Settings' `.field` inputs.

## Commits
- One focused Hearth-SelfMod commit per phase (P1, P2, P3, P4); each commit message lists
  the finding IDs it closes. Keep each phase self-contained and buildable (they're
  revertable from the app's History view).

## Done when
- All F1–F23 + S1–S6 are implemented per the doc and the locked decisions above.
- typecheck + lint + build + test are clean; the contrast probes pass AA in both themes;
  the live app renders every changed surface correctly in both themes (before/after
  captured).
- docs/ui-review.md is updated: mark each finding ✅ Done (or note any intentional
  deviation and why), and add a short "Implementation log" at the bottom — per phase:
  what changed, files touched, and the final contrast numbers.
- Restore the live app to a clean state (light theme, a normal session view) when finished.
```
