# Self-Mod Hardening Plan

Applying learnings from `ruuxi/stella` to Hearth's self-modification loop.
**Status: IMPLEMENTED** — all workstreams W0–W7 landed; `typecheck`, `lint`, `bun test`
(217 pass), and `bun run build` all green. Live in-app GUI verification (the `view_app`
checks) is the remaining manual step.

**W0b mediation spike — RAN (headless + live), result: does not compose; stays OFF.** A
headless harness drove the real `@zed-industries/claude-agent-acp` adapter with
`HEARTH_MEDIATE_WRITES=1` (two runs), and it was **re-confirmed live** in the running Electron
app via computer-use (a real self-edit to `hearth.css`). Findings: (1) the **diff stream is
unaffected** by advertising the `fs` capability (diffs streamed, edits applied, HMR fired) ✓;
(2) the adapter **does NOT route Edit/Write through the client `writeTextFile`** — it writes
disk directly (no `writeTextFile` call observed in either the harness or the live app), so the
broker would be inert ✗. The live run also confirmed the rest of the pipeline end-to-end: the
edit committed as a single self-mod (`captureTurn`/W2) touching only `hearth.css` and leaving
unrelated dirty files untouched, History rendered the grouping-aware UI, and the app booted
clean with every workstream's changes. Per the "enable-if-it-works" directive, mediation stays off. The broker is kept (tested) for a future
adapter that honors client fs. **Consequence:** W7 scope enforcement was relocated from the
(inert) broker to the **commit layer** — `captureTurn` rejects writes to the protected island /
secrets by restoring them on disk and not committing (works regardless of adapter or permission
mode). This is the active, tested enforcement path.

## Context

Hearth lets an agent rewrite its own running renderer. The *versioning* layer is
solid — commit-per-turn with trailers, Model A net-effect revert undo/redo, and
soul/memory categorization ([git.ts](../../electron/main/self-mod/git.ts),
[self-mod-service.ts](../../electron/main/self-mod/self-mod-service.ts),
[SELF-EVOLUTION-HISTORY.md](../SELF-EVOLUTION-HISTORY.md)). The *application* and
*recovery* layers are thin. A comparison against Stella surfaced four gaps, and a
fifth requirement emerged in review:

1. Edits hot-reload **per file save**, not per turn — multi-file changes flicker
   through partial states and can crash the renderer mid-turn.
2. There is **no crash/build-error recovery surface** — a broken self-edit leaves a
   dead window with no in-app way back.
3. The agent has **no design guidance** — token usage and UI consistency will drift.
4. There is **no validation gate** — nothing typechecks a self-edit.
5. **Parallel subagents are unhandled** — when a user asks the backend to spawn
   parallel subagents (Claude Code and Codex both support this), their interleaved
   writes are the worst case for gaps 1–2, nothing shows them working, and they
   collapse into one all-or-nothing commit.

**Scope note on concurrency.** The backend (Claude *or* Codex) is locked at the
session level — Hearth never runs two backends at once. The concurrency we handle is
**parallel subagents within a single turn**: one `host.prompt`, one `sessionId`,
multiple subagents editing files in parallel.

## The worked example (the bar we must clear)

> "Use parallel subagents to: (1) make the left sidebar always-visible and remove
> collapse, (2) change the heading to *My Hearth*, (3) make the right sidebar default
> to Scratchpad."

**Today:** one `host.prompt` ([ipc.ts:72](../../electron/main/ipc.ts)); the backend spawns
3 subagents; every edit streams as a `diff` nested in a `tool_call` under one
`sessionId` ([acp-translate.ts:153](../../electron/main/agents/acp-translate.ts)). Vite
hot-swaps each file the instant it's written, so the live UI lurches through partial
states and can crash mid-turn if one subagent's file references another's not-yet-written
symbol. `captureTurn` commits all three as **one** commit. No typecheck, no visualization.

**After this work:** all three subagents' writes are **pinned to their pre-edit baseline**
in the renderer; the live UI stays coherent while they work. At turn end everything
**swaps in atomically** — one coherent jump, state preserved. The turn becomes **N
file-disjoint commits** (so the heading change can be undone without touching the
sidebars), grouped under one run in History. A fast typecheck runs after; a dangling
import triggers **one auto-repair**. A dedicated panel shows the **subagents working
live**, each lane with its own files. Anything that still breaks drops into a **crash
surface** (Reload / Repair / Undo).

## Resolved design decisions

These were the open risks; each is now settled (see code grounding):

- **Scope = full Stella model with guards.** The agent may edit *anything in the repo* except a
  hard-blocked denylist (secrets/system/internal state) and a small protected island (the
  self-mod engine, boot watchdog, recovery anchor, hook config). `electron/main`, preload,
  configs, deps, and the behavioral-guidance files **are** live-editable. Safety comes from
  *recoverability* (overlay + revert + crash repair + boot watchdog), not from forbidding
  self-mod — exactly Stella's philosophy, adapted to Hearth's process topology (main is the
  host, so it needs W6's boot watchdog as its cushion). **⚠ This revises ARCHITECTURE.md**,
  which currently says main "is not the agent's canvas" / "no self-modification of compiled/
  native code" — that doc must be updated to reflect this decision (see Follow-ups).
- **Per-subagent attribution is feasible, not just degradable.** The Claude adapter
  attaches the parent Task id to every tool-call update:
  `update._meta.claudeCode.parentToolUseId` (`@zed-industries/claude-agent-acp/dist/acp-agent.js`).
  Our [acp-translate.ts](../../electron/main/agents/acp-translate.ts) currently drops `_meta`;
  threading it through gives real per-subagent attribution. (Codex: same `_meta` hatch
  exists; if unpopulated, that backend degrades to a single "main" group — no breakage.)
- **Baseline = git HEAD blob, not the stream's `oldText`.** Robust against shell-based
  writes (`sed`/`echo`) that emit no `diff`, and valid because the tree is clean at run
  start (the invariant [SELF-EVOLUTION-HISTORY.md](../SELF-EVOLUTION-HISTORY.md) already relies
  on). `oldText` is just a fast path. Path discovery for pinning = (diff-stream paths) ∪
  (paths that went clean→dirty during the run, via `listDirty`).
- **Commit grouping = file-disjoint connected components of (subagent ↔ file).** Subagents
  that share a file auto-merge into one commit, so **no two commits in a run share a file**
  → every commit is independently revertable; same-file collisions never produce a
  conflicting partial undo.
- **The overlay engages only when 2+ writers are concurrently active.** Single-agent turns
  keep immediate per-edit HMR, so the agent's `view_app` verify-as-it-goes loop works exactly
  as today. The moment a second concurrent writer (parallel subagent) is detected, the run
  enters **atomic mode**: further writes are pinned and held, then swap in together when the
  parallel phase resolves. This targets coherence at the real flicker/crash case (parallel
  subagents) without breaking the inspection loop for normal edits. Accepted tradeoff:
  single-agent multi-file turns can still flicker briefly — transient and caught by the crash
  surface (W3).
- **Layered write path: mediated where possible, observed everywhere.** Hearth advertises
  the ACP `fs` capability so the agent's Edit/Write tools route writes **through Hearth**
  (`client.writeTextFile`, supported by the Claude adapter at
  `@zed-industries/claude-agent-acp/dist/acp-agent.js:693`). The git-HEAD snapshot overlay
  remains the **universal fallback** because shell-based writes (`sed`/`echo`) bypass the fs
  capability — so the diff-stream ∪ clean→dirty path still covers them.
- **Same-file races: corruption prevented, lost-update auto-merged.** As the write broker,
  Hearth records what each subagent *read* and the baseline of each path it *writes*. On a
  mediated write whose base is stale (another subagent wrote first), Hearth runs a
  **3-way merge** (`git merge-file`); disjoint regions merge silently (no lost update, no agent
  involvement), and only a true line-level conflict escalates. Source writes are **forced onto
  this mediated path** (Claude PreToolUse hook; Codex permission-reject; fs-watch detection
  backstop), so shell writes can't silently bypass it. File-disjoint commit grouping keeps
  history revertable regardless.

## Goals

1. **Atomic, state-preserving apply** — pre-edit snapshot overlay (Stella port), one swap
   per turn.
2. **Per-subagent commits** — file-disjoint commits per turn, grouped in History.
3. **Crash + build-error recovery** — auto-repair once, then manual Reload / Repair / Undo.
4. **Live subagent visualization** — dedicated panel with per-subagent lanes + files.
5. **Enforced + advisory validation** — async typecheck after code edits; design +
   disjoint-file guidance in AGENTS.md.

## Architecture decisions

- **A "run" = one agent turn**, keyed `runId` + `sessionId`. All subagent writes belong to
  the one run; run-level pinning is what makes parallel-subagent apply atomic.
- **Attribution + path discovery from the ACP stream; baseline content from git HEAD.**
- **Overlay lives in a renderer Vite plugin; main coordinates over a dev HTTP endpoint**
  (`/__hearth/self-mod`) — the Vite dev server is a separate process from Electron main, so
  they can't share memory (mirrors Stella's `/__stella/self-mod/hmr`).
- **Overlay covers only Vite-served paths (`src/**`).** Non-renderer edits keep flowing
  through the existing `HmrController` full-reload / process-restart tiers
  ([hmr.ts](../../electron/main/self-mod/hmr.ts), [path-relevance.ts](../../electron/main/self-mod/path-relevance.ts)).
- **Model A revert is extended additively** — the per-commit net-effect engine is unchanged;
  run-grouping is a presentation + batch-undo layer on top.
- **Reuse:** `commitSelfMod({ paths })`, the revert graph, `toast()`
  ([toast.tsx](../../src/shell/toast.tsx)), `selfMod.*`, `agent.prompt`, `sessions.list()`, and
  the [channels.ts](../../electron/shared/channels.ts) → preload → `window.hearth` pattern.

## Workstreams

Each lands as one focused `Hearth-SelfMod` commit (single-agent edits, so each is itself one
clean commit).

### W0 — Run model, ACP attribution + path tracking, git-HEAD baseline  *(foundation)*
- New `electron/main/self-mod/run-tracker.ts`: `beginRun(runId, sessionId)`,
  `recordWrite(runId, path, { parentToolCallId, oldText })`, `endRun(runId) → { groups }`
  where `groups` are the file-disjoint components (each `{ paths, subagentLabel }`). Holds
  touched paths, per-path subagent attribution, and baselines.
- Extend `SessionUpdate` ([protocol.ts](../../electron/shared/protocol.ts)): add optional
  `parentToolCallId` to the `tool-call` and `diff` variants. In
  [acp-translate.ts](../../electron/main/agents/acp-translate.ts), read
  `update._meta?.claudeCode?.parentToolUseId` and thread it through.
- Tap the stream at [ipc.ts:49](../../electron/main/ipc.ts): map `sessionId → active runId`; on
  `diff`, `recordWrite` with its `parentToolCallId`; on `tool_call`, track Task lanes (for W4)
  and the **in-flight writer count** — the signal that drives W1's concurrency gate (1 writer →
  immediate HMR; 2+ → atomic mode).
- Baseline: capture lazily per path from `git show HEAD:<path>` (cache per run); fall back to
  stream `oldText`; new files (absent from HEAD) are unpinned.
- [ipc.ts:72](../../electron/main/ipc.ts) `agentPrompt`: mint `runId`, `beginRun`, `endRun`; pass
  groups to `captureTurn`.
- **Incomplete-run recovery:** at run start, if the tree is dirty with uncommitted changes (a
  prior turn that died before `captureTurn`), auto-commit them as a **recovered** run (own
  `Hearth-Run`, `Hearth-Recovered: true`) so they land in History/undoable, then start from a
  clean baseline. Never silently discard.
- Tests: `run-tracker.test.ts` — attribution grouping, file-disjoint component merge,
  baseline capture, clean→dirty discovery, new-file null, incomplete-run recovery.

### W0b — Write-mediation broker + source-write enforcement  *(layered; spike adapter first)*
- **Mediate.** Flip the ACP fs capability in [acp-client.ts](../../electron/main/agents/acp-client.ts)
  from `false` to `true`, and implement the client `readTextFile` / `writeTextFile` handlers
  (the adapter calls them — `acp-agent.js:689/693`). `readTextFile`: serve disk + record the
  version this caller read. `writeTextFile`: record/confirm baseline, feed
  `RunTracker.recordWrite`, then write to disk (so the agent's own read-after-write sees it).
- **3-way auto-merge (removes the retry dependency).** If a mediated write's base no longer
  matches what this run last saw (another subagent wrote first), run
  `git merge-file(base, current-disk, incoming)`. Clean (disjoint regions) → write the merged
  result and return **success** — no agent involvement, no lost update. Only a true line-level
  conflict is rejected/escalated (then the agent re-reads + retries, or it goes to conflict
  handling).
- **Force source writes onto the mediated path.** So shell writes can't silently bypass the
  broker:
  - *Claude:* write a **PreToolUse hook** into the managed `.claude` config (Hearth already
    manages it — [claude.ts](../../electron/main/agents/claude.ts)) that denies source-mutating
    shell (`sed -i`, `tee`, `>`/`>>` into `src/**`,`electron/**`, `cp`/`mv` onto tracked
    source) → the agent must use the Edit/Write tool, which is mediated. Runs regardless of
    permission mode.
  - *Codex:* no hook mechanism, so auto-reject the same commands at `host.onPermission`
    ([ipc.ts:57](../../electron/main/ipc.ts)) using `req.toolCall.rawInput.command` (confirmed
    present in codex-acp).
  - *Both:* Vite's existing file watcher is the universal **detection** backstop — any write
    that still slips through is caught post-hoc (overlay gives it atomic visibility; typecheck
    + auto-repair clean up).
- **Spike first (gating risk):** verify (a) Claude/Codex *subagent* writes route through the fs
  capability, and (b) the `diff` tool-call stream still arrives when fs is mediated. If either
  fails, mediation degrades to "observe only" and the overlay/diff-stream + enforcement path
  carries correctness.
- Tests: `write-broker.test.ts` — baseline record, 3-way merge (clean + conflict), read-version
  tracking, source-write denylist matching, fallthrough when capability unsupported.

### W1 — Snapshot overlay Vite plugin (concurrency-gated atomic apply)  *(core fix; spike first)*
- New `electron/vite-plugins/self-mod-overlay.ts` in `renderer.plugins`
  ([electron.vite.config.ts](../../electron.vite.config.ts)):
  - `configureServer`: `/__hearth/self-mod` middleware accepting `pin {path, baseline}` /
    `apply {paths}` / `release {paths}`; holds `Map<path, baseline>`.
  - `load(id)`: pinned path → return baseline instead of disk.
  - `handleHotUpdate`: while a path is pinned, **suppress** its HMR (return []); on `apply`,
    drop pins + force invalidate + send one HMR update so the swap is atomic.
- **Concurrency gate (the W0 refinement):** the overlay is driven only while a run has **2+
  concurrent active writers**. RunTracker tracks in-flight writers (main thread + each active
  subagent Task tool-call). Single-writer → no pins, normal HMR (agent's `view_app` loop
  intact). On entering concurrent mode, pin further writes with **baseline = current disk at
  pin time** (the last coherently-visible content; git-HEAD is the clean-start case). `apply`
  when the parallel phase resolves (or at `endRun`).
- New `isViteTrackablePath` in [path-relevance.ts](../../electron/main/self-mod/path-relevance.ts).
- Main posts `pin`/`apply` from RunTracker per the concurrency state. Non-renderer paths go
  through `HmrController.apply`.
- **Spike first:** prove single-file pin→edit→release keeps React state and HMRs cleanly on
  release before wiring the run/concurrency flow.
- Tests: `self-mod-overlay.test.ts` (path↔module-id mapping, pin/apply state machine,
  concurrency gate on/off transitions); `path-relevance` test for `isViteTrackablePath`.

### W2 — Per-subagent commits + History run-grouping
- `self-mod-service.ts` `captureTurn`: instead of one commit, commit each file-disjoint
  group from W0 (path-scoped, reuse `commitSelfMod({ paths })`), in deterministic order, with
  trailers `Hearth-Run: <runId>` + `Hearth-Subagent: <label>` added to the existing set.
  Subject from the Task tool-call title, fallback to first changed file. Single-group turns =
  today's one-commit behavior (zero regression).
- `git.ts` `recentSelfMods`: return `runId` + subagent label per entry (parse the new trailers).
- `History.tsx` ([History.tsx](../../src/app/history/History.tsx)): group rows by `runId`; a
  multi-member run renders expandable with **Undo all** (revert members in reverse via the
  existing `step()`/conflict→agent path) + per-member Undo. Single-member runs unchanged.
- Model A engine (`buildRevertGraph`/`isApplied`) untouched.
- Tests: `git.test.ts` additions — grouped commits, trailer parse, run net-effect state.

### W3 — Crash + build-error recovery surface  *(two layers; main-anchored authority)*
Two layers, because main is itself editable (full Stella model) so the in-renderer surface
can't be the only net:
- **First line (in-renderer UX):** `src/shell/ErrorBoundary.tsx` wrapping `<RouterProvider>`
  ([main.tsx](../../src/main.tsx)) + `src/shell/CrashSurface.tsx`. Catches React render errors and
  forwarded build errors. Actions: **Reload**; **Ask Hearth to repair** (pre-written prompt via
  `window.hearth.agent.prompt`, session = newest from `sessions.list()`); **Undo latest**
  (`selfMod.history()` → newest applied → `selfMod.undo`; run-grouping lets it target the whole
  latest run). Build errors: `server.hmr.overlay: false` + `src/lib/vite-error-recovery.ts`
  forwarding `import.meta.hot.on('vite:error')` → `CustomEvent` the boundary catches.
- **Authoritative net (main-anchored, in the protected island):** main watches the renderer
  (`render-process-gone`, unresponsive, or a heartbeat the renderer pings). If the renderer is
  wholly dead — or its own ErrorBoundary was broken by a self-edit — main shows a recovery
  surface from a **non-editable** location (a minimal recovery window/route) offering
  Reload / Undo-latest / Repair, driven straight from the self-mod engine. This code lives in
  the W7 protected island, so the agent can't disarm it even though it can edit the rest of the
  renderer *and* main.
- **Auto-repair once**, guarded by a last-error **signature** (Stella's `AUTO_REPAIR_SIGNATURE_KEY`
  pattern); **session circuit breaker** (max ~2/session) so a repair that keeps making *different*
  breakage can't loop — then force manual.

### W4 — Live subagent activity panel  *(full attribution)*
- Broadcast `self-mod:activity` (new channel) from RunTracker: `{ runId, sessionId,
  lanes: [{ toolCallId, title, status, paths }] }` — paths attributed per subagent via
  `parentToolCallId`; flag same-path-across-lanes collisions.
- `selfMod.onActivity(cb)` in [preload/index.ts](../../electron/preload/index.ts).
- New dedicated panel in the WorkPanel (alongside Review / Self / History,
  [src/app/workbench](../../src/app/workbench/)): live subagent lanes + their files + collision
  warnings; clears on finalize.
- Attribution sources: Claude via `_meta.claudeCode.parentToolUseId` (W0). Codex via a
  vendored fork-patch attaching `threadId → _meta` (the signal exists — `subAgentThreadSpawn`
  + per-notification `threadId`); gated on a spike confirming child-thread tool calls surface.
  Panel degrades to a combined-file view on any backend that doesn't supply attribution.

### W5 — Validation gate (enforced + advisory)
- **Advisory** — [AGENTS.md](../../AGENTS.md): a *Design* section (use
  [hearth.css](../../src/styles/hearth.css) tokens, reuse icon/component vocabulary, full-canvas
  pages, anti-slop rules, human copy); a *Parallel subagents* rule (partition by disjoint
  files; sequence shared-file work); a *Validation* line (`bun run typecheck`); and a *Live
  view semantics* note — single-agent edits hot-reload into `view_app` immediately, but during
  **parallel-subagent** work the live view is held and swaps atomically when the parallel phase
  finishes, so verify mid-parallel work via file reads / typecheck, not screenshots.
- **Enforced** — new `electron/main/self-mod/validate.ts`: after `captureTurn` commits a run
  touching `src/**`, run `typecheck` **async, non-blocking**; broadcast on
  `self-mod:validation`. On failure, reuse the W3 build-error surface (auto-repair-once applies).
  Restart-tier edits (`electron/**`, configs) are handled by W6's **blocking** gate instead.

### W6 — Restart-tier safety: blocking validation + boot watchdog
The renderer crash surface can't recover a broken main-process edit (main is down). Two guards:
- **Blocking pre-restart typecheck.** Before `HmrController` applies a `process-restart`-tier
  batch (main/preload/`electron.vite.config.ts`/manifests), run `typecheck` **synchronously**.
  Fail → **do not restart**; keep the current main alive, surface the error + Undo/Repair, and
  leave the commit revertable. (`captureTurn` still commits so it's in History.)
- **Boot watchdog.** On a self-mod-triggered restart, write a `pending-self-mod-restart`
  marker (commit hash + timestamp) before relaunch; clear it once main reaches `app:setReady`.
  If main starts and finds the marker still unconsumed from a *previous* boot (i.e., the last
  restart never reached ready) — or crashes within ~10s — **auto-revert that self-mod commit**
  (`git revert`, the existing safe path) and relaunch clean. Bounded retry count so a poisoned
  revert can't loop into its own crash cycle (after N, boot to a minimal safe-mode shell).
- Files: watchdog in main bootstrap ([index.ts](../../electron/main/index.ts)) + a small
  `electron/main/self-mod/boot-watchdog.ts` (marker read/write, crash-window timer, revert
  call); blocking-gate hook in `HmrController.apply` / `SelfModService`.
- Tests: `boot-watchdog.test.ts` — marker lifecycle, crash-window revert, retry cap.

### W7 — Scope guard: blocked-path denylist + protected safety-net island
Hearth has **no** write-side path guard today (the agent writes straight to disk via ACP). Port
Stella's `isBlockedPath` model and add Hearth's protected island. Two tiers:
- **Hard-blocked (never writable, no override)** — port Stella's
  [command-safety.ts](https://github.com/ruuxi/stella) set: system dirs (`/etc`, `/usr`,
  `~/.ssh`, `~/.aws`, `~/.config/gh`, cloud creds…), credential/secret files (`.env`,
  `auth.json`, `.git-credentials`, shell rc files), Hearth internal state
  (`.hearth/bridge-url`, snapshot, session-index internals), and device files.
- **Protected island (editable only with explicit user approval)** — the self-mod engine and
  recovery anchor that must survive even though the rest of main is editable:
  `electron/main/self-mod/**`, the **boot watchdog + minimal bootstrap** (W6), the
  **main-anchored recovery surface** (W3), and the managed `.claude` hook config + hook script.
- **Everything else is the canvas** — `src/**`, skills, prompts, `.hearth` personality/memory,
  guidance files (AGENTS.md/CLAUDE.md), `micro-apps/**`, **and the rest of `electron/main`,
  `electron/preload`, configs, deps** (live-editable per the full-Stella choice, guarded by W6).
- Enforce at the **commit layer** (`captureTurn`, the active path since the mediation broker is
  inert with the current adapter — see the spike result up top): hard-blocked + protected paths
  have their working-tree edits **restored from HEAD (or deleted if new) and are not committed**;
  the rejection is surfaced to the user; canvas paths commit normally. The broker enforces the
  same tiers when mediation is ever viable. (Protected paths are treated as off-limits for now;
  an explicit user-approval flow is a follow-up.)
- **Dependency isolation (airtight requirement).** The island must not `import` from editable
  main code, or the agent could break it *indirectly* by editing a transitive dependency. The
  watchdog bootstrap, scope guard, and recovery anchor must be self-contained (or only depend on
  other island modules). Add a boundary test that fails if anything under the island imports a
  non-island path.
- Tests: `scope-guard.test.ts` — hard-block matching, protected-island approval gate,
  canvas pass, secret/system denial; `island-boundary.test.ts` — no island→canvas imports.

## Verification

- **W0 / W2:** `bun test` — `run-tracker.test.ts`, `git.test.ts` additions; existing
  `self-mod-service.test.ts` green.
- **W1 (worked example):** drive the live app via `hearth` MCP; run the 3-subagent prompt;
  `view_app` mid-turn (coherent, unchanged) and at finalize (one atomic swap, state preserved).
- **W2:** confirm the turn produced 3 file-disjoint commits under one run; undo just the heading
  commit and verify the sidebars stay; force a same-file collision and confirm those subagents
  merged into one commit.
- **W3:** write (a) a renderer file that throws on render and (b) one that won't parse; confirm
  the crash surface for both, auto-repair fires once and is loop-guarded, Undo restores.
- **W4:** `view_app` during the 3-subagent run; panel shows 3 lanes with their files live.
- **W5:** introduce a type error in a `src/**` edit; `self-mod:validation` surfaces it with
  repair/undo, turn result still returns.
- **W6:** have the agent write main-process code that (a) won't typecheck → confirm the restart
  is refused and old main stays up; (b) typechecks but throws on boot → confirm the watchdog
  auto-reverts and relaunches clean. Confirm the retry cap stops a revert-crash loop.
- **W7:** have the agent attempt to edit `electron/main/self-mod/git.ts` and the `.claude` hook
  config → confirm both are denied without explicit UI approval, and a normal `src/**` edit is
  unaffected.
- **Full gate:** `bun run typecheck`, `bun run lint`, `bun test`.

## Residual limitations — what's truly left

After mediation + 3-way merge + source-write enforcement + universal detection, the residue is
narrow and each item is either recoverable or correct-by-design:

- **A broken `electron/main` edit is recovered, not prevented.** Because main is live-editable
  (full Stella model), a bad main edit that bricks boot triggers a crash-and-recover cycle: the
  W6 boot watchdog (in the protected island) auto-reverts and relaunches. The user may see one
  failed launch before recovery. Preventing it outright would require scoping main out — which
  we explicitly chose not to do. The blocking pre-restart typecheck catches the common case
  before it ever restarts.
- **Exotic/evasive un-mediated writes** (a Python script that writes a file, an obfuscated
  redirect the denylist misses). Not *pre-empted*, but the fs-watch backstop **detects** them,
  the overlay gives them atomic visibility, and 3-way merge + typecheck + auto-repair recover.
  Pre-emption for *every* path would need a custom filesystem (FUSE) — impractical to ship; we
  accept detect-and-recover here.
- **Genuine same-file line-level conflicts** between two subagents go to the agent/conflict
  path. This is correct behavior (truly entangled edits can't be auto-separated), not data loss.
- **Codex attribution pending a fork-patch.** The signal *exists* — Codex has subagent threads
  (`subAgentThreadSpawn`) and notifications carry `threadId` — but the adapter doesn't forward
  it to ACP `_meta` yet. Recoverable via a vendored fork-patch attaching `threadId → _meta`
  (same pattern as Claude), gated on a spike confirming child-thread tool calls surface through
  the adapter. Until then Codex degrades to one-commit-per-turn + combined-file panel — no
  correctness loss.
- **Single-agent multi-file edits can flicker briefly.** Accepted tradeoff: the overlay only
  engages for 2+ concurrent writers, so a lone agent's sequential multi-file edit hot-reloads
  per file (preserving its `view_app` loop). Transient and caught by the crash surface;
  dependency-disjoint incremental apply could remove it later if desired.
- **During a parallel-subagent phase, the live UI doesn't rebuild piece by piece** — it swaps
  once when the phase resolves (the activity panel shows progress meanwhile). Deliberate.
- **Minor, documented:** reverting a commit that changed `package.json`/`bun.lock` may need a
  follow-up `bun install` (dependency-manifest reverts don't re-run install); HMR-incapable
  modules lose component state on overlay release (most React modules support Fast Refresh);
  the shell-write denylist must be scoped to hand-edited source, not generated/build outputs.

## Sequencing

W0 → **W0b spike** (decide if mediation is viable before relying on it) + **W7** (protected
paths — same broker/enforcement layer) → W1 (core robustness, fixes the worked example) → W2
(per-subagent commits + History) → **W3 + W5 + W6** (recovery + validation cluster: the
renderer crash surface, the async renderer gate, and the blocking restart gate + boot watchdog
all share plumbing) → W4 (panel, builds on W0 attribution). Run W0b's spike early: if mediation
can't carry subagent writes, we lose nothing — the overlay + source-write enforcement already
cover correctness, and mediation just adds collision-prevention where available. The cross-run
contention tracker (Stella port) is deferred insurance — only needed if two sessions ever
self-edit at once — and can land after, or be dropped from v1.

W6 (the boot watchdog) is the highest-severity guard — prioritize it before the agent does
much restart-tier (`electron/**`) self-editing.

## Follow-ups

- ~~**Update [ARCHITECTURE.md](../ARCHITECTURE.md)** to match the decided scope.~~ **Done** — the
  one-idea section, process boundaries, the self-evolution engine section, the diagram, and the
  "do NOT do" list now state: the agent may edit any repo source except the hard-blocked denylist
  and the protected safety-net island; main edits are live but guarded by the boot watchdog +
  blocking typecheck.
- **Codex attribution fork-patch** (W4) — vendored patch attaching `threadId → _meta`, gated on
  the child-thread spike.
- **Dependency-manifest reverts** may need a follow-up `bun install` (not auto-run on revert).
