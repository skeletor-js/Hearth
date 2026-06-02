# Seamless Self-Mod Plan — kill the black screen

When a user asks Hearth to change its own UI, it should *just happen*. Today most
edits hot-swap invisibly, but **structural edits flash a black screen**: adding a
route, editing `index.html`, or touching the main process forces a full reload (or
restart) and the renderer goes blank while it re-bootstraps.

This plan makes UI self-mods seamless, in two parts, both modeled on Stella (the
reference implementation Hearth is ported from — repo `ruuxi/stella`):

- **Part A — Route-tree HMR.** Make route additions/edits hot-swap live instead of
  full-reloading. Stella does this with a one-block HMR boundary in its router;
  their only full-reload file is `index.html`.
- **Part B — The morph cover.** For the reloads/restarts that genuinely can't be
  hot-swapped, never show black: screenshot the current UI, cover the window with
  it in a separate overlay window, do the reload **behind the cover**, screenshot
  the new UI, and animate a morph between them. Stella's `hmr-morph` /
  `overlay-window` subsystem.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Grounding (current state — verified)

Hearth side:
- **Reload tiers** ([path-relevance.ts](../../electron/main/self-mod/path-relevance.ts)):
  `hmr` (most of `src/`), `full-reload` (`index.html`, `src/routeTree.gen.ts`,
  `src/routes/`), `process-restart` (`electron/main/**`, `electron/preload/**`,
  configs). `classifyBatch` returns the strongest.
- **HmrController** ([hmr.ts](../../electron/main/self-mod/hmr.ts)): on `full-reload`
  calls `reloadWindow()` → `window.webContents.reload()`; on `process-restart`
  relaunches (packaged) or reloads (dev). We just added `viteServed` so the
  redundant hard reload is skipped when Vite already reloads.
- **Router** ([main.tsx](../../src/main.tsx)): `createRouter({ routeTree, history:
  createMemoryHistory() })`, rendered via `<RouterProvider>`. **No
  `import.meta.hot` accept** — so a `routeTree.gen.ts` change propagates to the
  entry and Vite full-reloads.
- **Self-mod overlay plugin** ([self-mod-overlay.ts](../../electron/vite-plugins/self-mod-overlay.ts)):
  already pins module baselines and applies atomically *for parallel-subagent
  turns* via a dev endpoint + `server.reloadModule`. Single-writer turns don't pin.
- **Screen capture already exists**: `webContents.capturePage().toPNG()` is used in
  [agent-bridge.ts](../../electron/main/agent-bridge.ts) for snapshots.
- **Windows** ([window.ts](../../electron/main/window.ts)): main window
  `backgroundColor: '#0b0b0e'`; a separate snapshot window already exists. Nav
  guards (deny window.open / off-origin nav) were just added.
- `index.html` paints `#0b0b0e` from first frame (last fix), so any residual flash
  is dark, not white.

Stella side (read from `ruuxi/stella@master`):
- **Route HMR** (`desktop/src/router.tsx`): `import.meta.hot.accept("./routeTree.gen.ts",
  (m) => { router.update({ routeTree: m.routeTree }); void router.invalidate() })`.
  Their `FULL_WINDOW_RELOAD_FILES` set = **only `desktop/index.html`**; route files
  expand the batch to also reload the generated route-tree module (no browser reload).
- **Morph cover** (`desktop/electron/self-mod/hmr-morph.ts`,
  `desktop/electron/windows/overlay-window.ts`, `morph-transition-helpers.ts`,
  `desktop/src/shell/overlay/MorphTransition.tsx`, `MorphInputAbsorber.tsx`,
  `src/shared/contracts/morph-timing.ts`, `ipc/morph-handlers.ts`): a transparent,
  all-display overlay `BrowserWindow` shows a screenshot cover; the apply/reload
  runs behind it (`suppressClientFullReload` while covered); then it morphs old →
  new screenshot. Tiered timing (`MORPH_RENDERER_*` vs `MORPH_RELOAD_*`,
  `settleDelayMs`, `coverRampMs`, `handoffFadeMs`).

### The Hearth-specific catch
Stella's `process-restart` is a **worker** restart — their Electron shell + overlay
window stay alive and cover it. Hearth's restart tier is `electron/main` /
`electron/preload`, i.e. the **whole Electron process** (electron-vite in dev,
`app.relaunch()` packaged). That kills the overlay window too, so it can't cover a
restart the same way. Covering restarts needs a persist-screenshot-across-boot
trick (Part B, W7) and is the hard tail; renderer reloads (the common structural
case) are fully coverable.

---

## Goals
- Adding or editing a route/page hot-swaps live — **no reload, no flash**.
- Any reload that can't be hot-swapped (e.g. `index.html`) is **hidden behind a
  morph cover** — the user sees old UI → smooth transition → new UI, never black.
- The cover is robust: it appears before the reload, absorbs input during it, and
  reveals only once the new UI has painted.
- Degrade gracefully: if the overlay fails, fall back to today's single dark reload
  (never worse than now).

## Non-goals
- A photoreal "liquid" shader. Start with a polished crossfade/displacement; the
  fancier transition is a later visual upgrade.
- Covering the **dev** main-process restart (electron-vite owns that lifecycle; a
  brief flash there is acceptable and out of scope — see Residual).
- Changing the agent's mid-turn `view_app` behavior (it keeps seeing live edits).

---

## Part A — Route-tree HMR  *(ATTEMPTED — infeasible in this setup)*

> **Finding (2026-06-01): live route-tree HMR does not work under Hearth's
> electron-vite + @tanstack/router-plugin setup, so Part A is abandoned in favor
> of a morph-covered reload (Part B).** Evidence, verified live via the eval bridge:
> the router-HMR accept boundary *does* prevent the hard reload (a `window`
> sentinel survives), but a newly-created route module is **never picked up by
> HMR re-execution** — `mod.routeTree` handed to the accept callback consistently
> lacks the new route, even though the route file is on disk, is included in the
> regenerated `routeTree.gen.ts`, and imports fine on its own; a **fresh boot
> registers it correctly**.
>
> **Every modification Stella uses was tried and none fixed it here:** the
> separate-`router.tsx` accept module, a cache-busted `import('/src/routeTree.gen.ts?t=…')`
> re-import, `autoCodeSplitting: true` on the router plugin, and a dev plugin
> calling `server.moduleGraph.invalidateAll()` on every `routeTree.gen` change.
> In all cases: no reload (good) but the new route never enters the live tree.
> This is an electron-vite module-graph incompatibility that plain-Vite Stella
> doesn't hit — electron-vite won't re-crawl a newly-created route module on HMR.
> Net: a full reload is *required* to register a new route. So routes stay on the
> `full-reload` tier and are made seamless by hiding that reload behind the morph
> cover (Part B) — not by live HMR. A1/A2 below are kept for the record.
>
> **Spike (decisive): electron-vite is NOT the cause — do not migrate off it.**
> Stella runs the renderer on plain Vite (not electron-vite), so the obvious
> suspect was our bundler. A throwaway spike served the renderer with **plain
> Vite** (reusing the built main/preload, Electron pointed at the plain-Vite URL)
> and ran the same add-a-route test: **route-HMR failed identically** — new route
> never registers, no reload. Removing our `selfModOverlay` plugin from the plain-
> Vite config didn't change it either. So the broken new-route HMR is at the
> Vite + @tanstack/router-plugin layer itself, independent of electron-vite and of
> our overlay.
>
> **Vite version + autoCodeSplitting ruled out too (exhaustive).** Tested the
> renderer on plain Vite **6, 7, and 8** (8 = Stella's exact version, with
> `@vitejs/plugin-react@6`), and with **`autoCodeSplitting: true`** (Stella's exact
> router-plugin config) on Vite 8 — **every combination fails identically**: the
> accept fires, no reload, but the new route never registers. So it is NOT the
> bundler, NOT our overlay, NOT the Vite major, NOT autoCodeSplitting. The cause is
> some deeper route-module/regenerated-tree interaction specific to this codebase
> that we could not isolate without disproportionate effort. (Aside: electron-vite
> caps at Vite 7 — no version supports Vite 8 — so Vite 8 would force the migration
> anyway, and it doesn't even fix the bug.) **Final outcome: route-HMR abandoned;
> keep electron-vite + Vite 6; cover route reloads (and index.html) with the morph
> (Part B).** The spike sequence paid for itself by ruling out a large, risky
> migration that would have fixed nothing.

### A1 — HMR boundary in the router
- `[ ]` In [main.tsx](../../src/main.tsx), after `createRouter`, add the Stella
  pattern: `if (import.meta.hot) import.meta.hot.accept('./routeTree.gen', (m) => {
  if (m?.routeTree) { router.update({ routeTree: m.routeTree }); void
  router.invalidate() } })`. Match the import specifier exactly. Memory history
  means the current location is preserved across the swap.
- **Files:** [main.tsx](../../src/main.tsx).
- **Acceptance:** with the dev app running, adding a new `src/routes/*.tsx` and
  navigating to it works with **no full reload** (verify: no blank, router state
  preserved; watch via computer-use / the eval bridge).

### A2 — Reclassify routes off the full-reload tier
- `[ ]` In [path-relevance.ts](../../electron/main/self-mod/path-relevance.ts), remove
  `src/routes/` and `src/routeTree.gen.ts` from the `full-reload` classification so
  they fall to `hmr` (Vite + the A1 accept handle them). Leave `index.html` as the
  only `full-reload` exact. Update [path-relevance.test.ts](../../electron/main/self-mod/path-relevance.test.ts)
  and the self-mod-service route-edit tests accordingly.
- **Files:** path-relevance.ts (+ tests), self-mod-service.test.ts.
- **Acceptance:** `classifyBatch(['src/routes/foo.tsx'])` → `hmr`; a route-adding
  self-mod no longer triggers `reloadWindow()`; existing suites green.

---

## Part B — The morph cover  *(the magic)*

A self-contained overlay window + an orchestration controller. Built incrementally
so each piece is testable and the app stays shippable between steps.

### B1 — Overlay window
- `[ ]` New `electron/main/windows/overlay-window.ts`: a frameless, transparent,
  always-on-top `BrowserWindow` spanning all displays (union of
  `screen.getAllDisplays()` bounds), non-focusable, `setIgnoreMouseEvents` until a
  morph is active, re-spanned on display changes. Loads a tiny dedicated overlay
  renderer (its own route/HTML + the existing preload, or a minimal preload).
  Lifecycle: `ensure()/show()/hide()/destroy()`, `ready` gate.
- **Files:** new `electron/main/windows/overlay-window.ts`; small overlay
  entry in `src/` (route or standalone html).
- **Acceptance:** overlay window can be shown over the main window, transparent,
  click-through when idle; doesn't steal focus; cleans up.

### B2 — Capture + signal plumbing
- `[ ]` Main-side capture helper: `captureMainFrame()` →
  `window.webContents.capturePage().toPNG()` → data URL (reuse the
  [agent-bridge](../../electron/main/agent-bridge.ts) pattern).
- `[ ]` IPC contract (`electron/shared/channels.ts` + preload): main → overlay
  `morph:cover({oldFrame})`, `morph:handoff({newFrame})`; overlay → main
  `morph:overlay-ready`, `morph:cover-painted`, `morph:done`. Timeouts so a stuck
  overlay never hangs the app.
- **Files:** channels.ts, preload, new `electron/main/ipc/morph-handlers.ts`.
- **Acceptance:** main can hand the overlay a screenshot and await a
  `cover-painted` / `done` signal with bounded timeouts.

### B3 — Morph transition surface (overlay renderer)
- `[ ]` `src/shell/overlay/MorphTransition.tsx`: receives old + new frames, paints
  the old frame full-bleed, then animates to the new (start with a polished
  crossfade + subtle scale/displacement; structure it so the transition is
  swappable). `MorphInputAbsorber` swallows pointer/key events while active.
- `[ ]` Timing contract `src/shared/contracts/morph-timing.ts`: tiered
  `coverRampMs` / `handoffFadeMs` / `settleDelayMs` for `renderer` vs `reload`
  tiers (Stella's defaults are a sane starting point: ~550/1050 ramp, ~1100 fade,
  ~600/1250 settle).
- **Files:** MorphTransition.tsx, MorphInputAbsorber.tsx, morph-timing.ts.
- **Acceptance:** given two PNGs, the overlay shows old → animated transition → new
  smoothly at 60fps; input is absorbed during it.

### B4 — Morph controller (orchestration)
- `[ ]` New `electron/main/self-mod/hmr-morph.ts` with `runTransition({ tier,
  applyBehindCover })`:
  1. capture old frame → 2. show overlay, send `morph:cover`, await
  `cover-painted` → 3. run `applyBehindCover()` (the actual reload/HMR, with the
  client full-reload suppressed until covered) → 4. await settle (tiered) →
  5. capture new frame → `morph:handoff` → 6. await `morph:done` → hide/destroy.
  Hard timeouts at every await; on any failure, reveal immediately (degrade to a
  plain reload).
- **Files:** hmr-morph.ts.
- **Acceptance:** a forced full reload run through `runTransition` shows the cover
  for the whole reload and reveals only after the new frame paints — no black at
  any point.

### B5 — Wire the cover into the reload path
- `[ ]` Route `HmrController`'s `full-reload` tier through `hmr-morph.runTransition`
  instead of a bare `reloadWindow()`. `applyBehindCover` triggers the Vite reload
  (or `webContents.reload()` for the static fallback) while the cover is up.
- `[ ]` Decide HMR-tier policy: leave pure `hmr` edits uncovered (they're already
  flicker-free) **unless** a batch also includes a `full-reload` path. Optionally
  add a very short cover for multi-file HMR batches to guarantee atomic reveal —
  evaluate after B4.
- **Files:** [hmr.ts](../../electron/main/self-mod/hmr.ts),
  [index.ts](../../electron/main/index.ts) (construct overlay + controller, inject).
- **Acceptance:** editing `index.html` (or any full-reload-tier file) via a self-mod
  shows a morph, never a black flash. `hmr`-tier edits still hot-swap with no cover.

### B6 — Atomic apply for single-writer turns *(optional, evaluate after B5)*
- `[ ]` Extend the existing [overlay plugin](../../electron/vite-plugins/self-mod-overlay.ts)
  to pin during single-writer turns too, so the user never sees half-written
  intermediate states mid-turn (the agent's own `view_app` can still opt out / see
  live). Apply atomically at turn end, under the morph cover when a reload is needed.
- **Acceptance:** during a multi-edit turn the user's window shows the pre-turn UI
  until the turn completes, then transitions once to the final UI.

### B7 — Restart coverage across boot *(stretch / the hard tail)*
- `[ ]` For `process-restart` (main/preload) in **packaged** builds: before
  `app.relaunch()`, persist the last-frame screenshot to disk; on next boot, show
  it as the overlay cover immediately, then morph once the new renderer paints.
  Dev (electron-vite) restart is explicitly out of scope.
- **Acceptance (packaged):** a main-process self-mod relaunch shows the last frame
  through the restart and morphs to the new UI instead of a black launch.

---

## Verification
- **A:** add a route live → no reload (computer-use watch + eval bridge confirms
  router state preserved, no blank). Unit: classifier returns `hmr` for routes.
- **B:** force a `full-reload`-tier self-mod (e.g. edit `index.html`) and confirm,
  via computer-use video/screenshots, that there is **no black frame** — old UI,
  morph, new UI. Overlay timeouts verified by simulating a stuck overlay (falls
  back to plain reload).
- **Always-green gate:** `bun run typecheck`, `bun run lint`, `bun test`,
  `bun run build` after each workstream; app boots clean (these are
  `electron/main` changes → app restarts).

## Residual limitations
- **Dev main-process restart still flashes.** electron-vite owns the dev process
  lifecycle; B7 only covers packaged relaunch. Acceptable — self-mods rarely touch
  the main process, and dev is the developer's context, not the user's.
- **Dependency re-optimization reloads** (Vite re-bundling a newly imported dep)
  are full reloads — they'll be *covered* by the morph (B5) but not eliminated.
  Optional follow-up: warm common deps via `optimizeDeps.include`.
- **Fast Refresh boundary violations** (a component file also exporting a constant,
  or editing a widely-imported store) still cause a Vite full reload — covered by
  the morph, not eliminated. Follow-up: agent-side code-style guidance + splitting
  stores/hooks out of component modules.

## Sequencing
- ~~A1 + A2 first~~ — **abandoned** (route-HMR infeasible here; see the Part A
  finding). Routes stay `full-reload` and are covered by the morph instead.
- **Revised ordering (since the morph now carries routes too):**
  - **B1 → B2 → B3 → B4** — overlay window, capture/IPC, transition surface,
    controller. Independently testable; the app keeps today's behavior until wired.
  - **B6 BEFORE B5 (prerequisite, not optional).** To cover a reload we must
    control *when* it happens: Vite reloads autonomously on file save (mid-turn),
    before the controller runs. So the overlay plugin must **pin/suppress** the
    autonomous HMR during a turn (extend `self-mod-overlay`'s pin path to single-
    writer turns), then the controller applies the reload at turn end **under the
    cover**. Without this, the reload fires uncovered and the cover is pointless.
  - **B5** — wire the controller into the `full-reload` tier (and the suppressed
    apply) so route/index.html edits morph instead of flashing.
  - **B7** — packaged restart coverage, last.

## Follow-ups (out of scope)
- Fancier morph transition (displacement/shader) once the crossfade ships.
- `optimizeDeps.include` warming for new-dependency reloads.
- Fast-Refresh hygiene guidance baked into the agent's instructions.
