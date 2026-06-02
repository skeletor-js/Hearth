# V2 Packaging & Gap-Closure — implementation plan

## Implementation status (2026-06-01)

Code-complete and statically verified (254 tests pass; typecheck, lint, and
`electron-vite build` all green):

| Item | Status |
|---|---|
| WS1-1 env-scrub harness | ✅ Done — [child-env.ts](../electron/main/agents/child-env.ts), wired in [acp-client.ts](../electron/main/agents/acp-client.ts), `HEARTH_SCRUB_INHERITED_KEYS=1` |
| WS2-1 writable workspace (option A) | ✅ Done — [workspace.ts](../electron/main/packaging/workspace.ts), seed/reuse/reseed tested against real git |
| WS2-2 runtime Vite server | ✅ Done — [renderer-server.ts](../electron/main/packaging/renderer-server.ts), externalized in the main bundle |
| WS2-3 lifecycle + static fallback | ✅ Done — [dev-server.ts](../electron/main/dev-server.ts) `prepareRenderer()`, [window.ts](../electron/main/window.ts), quit cleanup in [index.ts](../electron/main/index.ts) |
| WS2-4 electron-builder config | ✅ Written — `build` block in [package.json](../package.json); needs a real `bun run dist` to validate |
| WS2-5 entitlements + notarize | ✅ Written — [entitlements.mac.plist](../build/entitlements.mac.plist), [notarize.cjs](../build/notarize.cjs) afterSign hook (gated on Apple creds) |
| WS3 skills enable/disable | ✅ Done — [list.ts](../electron/main/skills/list.ts) `setSkillEnabled`, IPC + preload + [SkillsSection](../src/app/settings/sections/SkillsSection.tsx) toggle |
| WS4 doc reconciliation | ✅ Done — MILESTONE-V1 boxes, BUILD-PLAN deferred line, this table |

**Environment-gated (cannot complete in the build sandbox):**
- WS1-2/3/4 — live talk → self-edit → HMR → undo, and the `v1` tag (needs a model
  turn on real hardware; the WS1-1 harness makes this runnable from a dev shell).
- WS2-4/2-5 end-to-end — an actual `bun run dist` build, code-signing, and
  notarization (need the macOS toolchain + Apple Developer credentials).
- WS3 live UI — the in-app toggle screenshot (the dev watcher held a stale main
  process; static checks pass).

---

Status: implemented per the table above. Covers the four open items from the 2026-06-01 stub/TODO audit:
close out the `v1` tag (verification, not code), ship the **packaged
self-evolving build** (the one real `TODO(v2)`), optionally wire **skills
enable/disable**, and reconcile stale plan docs.

The big piece is the packaged build. Unlike a normal Electron app, Hearth's
packaged build must **run Vite at runtime** — it ships renderer *source* and a
live Vite server, not a frozen bundle, because that server is what makes agent
self-edits hot-reload. See [ARCHITECTURE.md](./ARCHITECTURE.md) (the renderer is
"served by a *live Vite dev server* — not a frozen bundle"). Today
[`resolveRendererTarget()`](../electron/main/dev-server.ts) falls back to the
static bundle in packaged builds (`TODO(v2)`), which works for `electron-vite
preview` but kills self-evolution in production.

## State today

- **No `electron-builder` config exists.** The `dist` script
  (`electron-vite build && electron-builder --mac`) runs the builder with **zero
  configuration** — packaging is unstarted, not half-done.
- **The runtime Vite server is unwritten.** `resolveRendererTarget()` returns the
  dev-server URL when `ELECTRON_RENDERER_URL` is set (dev), else the static file.
  The v2 branch — start a shipped Vite server, write `.vite-dev-url`, return it —
  is a `TODO(v2)`. `ARCHITECTURE.md:68` notes the intent: "port Stella's
  `dev-url.ts`."
- **`v1` is unverified, not unbuilt.** Per [hearth-v1-status] and
  [BUILD-PLAN.md](./BUILD-PLAN.md) (`P2-4`, `Tag v1`), the live loop
  (talk → self-edit → HMR → undo) and auth smoke test have never run because the
  Claude Code sandbox leaks `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` into spawned
  agents and the gateway rejects them (see [acp-integration-gotchas]).

## Decisions (settled)

- **Writable source location: copy-to-userData (option A).** On first launch the
  packaged app copies its renderer source + git repo into a writable directory
  under `userData/` (macOS App Support); Vite root and all self-mod `git`
  operations point there. A signed `.app` is read-only, so self-edits cannot
  write into the bundle — they need a writable home that survives app restarts.
  This shapes the whole packaging workstream (WS2). The alternatives (open a
  user-chosen working dir; or keep self-evolution dev-only) were rejected:
  A keeps the "self-evolving desktop app" model intact with a clean update story.

---

## WS1 — Close out v1 (verification, no new product code)

Cheapest, highest-value. Everything here is built and tested; this is observation
plus the tag. The only blocker is environmental.

### WS1-1. Env-scrub launch harness *(the one piece buildable without real hardware)*

A launch wrapper that strips the leaked `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
(and any `OPENAI_*` equivalents) from the environment before Hearth spawns its
agent subprocess, so the live loop is runnable even from inside a dev/sandbox
shell rather than only on a clean machine. Removes the "needs a pristine machine"
caveat permanently.

- Scrub at the agent-spawn boundary, not globally — Hearth itself may legitimately
  read those vars elsewhere. Likely in the adapter `env` assembly
  ([acp-agent.ts](../electron/main/agents/acp-agent.ts) /
  [claude.ts](../electron/main/agents/claude.ts) /
  [codex.ts](../electron/main/agents/codex.ts)), gated behind a
  `HEARTH_SCRUB_INHERITED_KEYS=1` opt-in so normal BYO-key flows are untouched.
- Acceptance: with the flag on inside a sandbox shell, a spawned agent uses only
  the user-provided credential and the gateway accepts the turn.

### WS1-2. Auth smoke test (`BUILD-PLAN P2-4`)

On real hardware (or via WS1-1): launch Hearth, authenticate via BYO
`ANTHROPIC_API_KEY` (COMPLIANCE-blessed path), confirm handshake → session →
streamed message. Repeat for Codex (`codex login` and BYO `OPENAI_API_KEY`).

### WS1-3. Full live loop

talk → self-edit → HMR reload → Undo from the History view. Confirm the
`Hearth-SelfMod` commit lands and reverts cleanly (the undo-bug fix from Phase 3
is exercised here for real).

### WS1-4. Tag `v1`

Once WS1-2 + WS1-3 pass. Flip `BUILD-PLAN.md` `Tag v1` and `P2-4`.

**Depends on:** nothing. WS1-1 is buildable now; WS1-2/3/4 need a model turn.

---

## WS2 — Packaged self-evolving build

The long pole. Internal sequence below; **WS2-1 (the copy-to-userData runtime)
is the keystone** and must land before the server work.

### WS2-1. Writable source bootstrap (option A)

On first launch of a packaged build (detected by absence of
`ELECTRON_RENDERER_URL` **and** a packaged flag), copy the shipped renderer
source tree + a git repo into `userData/<app>/workspace/`. Subsequent launches
reuse it. This becomes Vite's `root` and the cwd for every self-mod `git`
operation ([self-mod-service.ts](../electron/main/self-mod/self-mod-service.ts),
[git.ts](../electron/main/self-mod/git.ts)).

- **Update story:** when the shipped app version is newer than the workspace's
  recorded version, reconcile (e.g. re-seed from the bundle while preserving the
  user's `Hearth-SelfMod` commits via a rebase/branch, or prompt). Define this
  explicitly — it is the main risk in option A.
- Acceptance: packaged app boots against the userData workspace; a file written
  there is picked up by HMR; `git log` shows commits in the userData repo.

### WS2-2. Runtime Vite server (port Stella's `dev-url.ts`)

In [`resolveRendererTarget()`](../electron/main/dev-server.ts), when there is no
`ELECTRON_RENDERER_URL`, programmatically `createServer()` from `vite` using the
renderer config from
[electron.vite.config.ts](../electron.vite.config.ts) — **including the
`selfModOverlay` plugin** — with `root` = the WS2-1 workspace. Listen on an
ephemeral port, write the URL to `.vite-dev-url`, return `{ url }`.

- The `selfModOverlay` + HMR + crash-surface plumbing
  ([self-mod-overlay.ts](../electron/vite-plugins/self-mod-overlay.ts),
  [vite-error-recovery.ts](../src/lib/vite-error-recovery.ts)) must attach to this
  production server exactly as they do to electron-vite's dev server.
- Acceptance: packaged app loads the renderer over `http://localhost:<port>` and a
  self-edit hot-reloads with no restart.

### WS2-3. Server lifecycle + static fallback

Start the Vite server before the `BrowserWindow` loads
([window.ts](../electron/main/window.ts) /
[index.ts](../electron/main/index.ts)); stop it on `app` quit; handle port
conflicts. **On any boot failure, fall back to today's static-bundle path** —
keep the current `{ file }` branch as the safety net, do not delete it.

- Acceptance: kill the Vite server mid-run → app degrades to static bundle and
  stays usable; clean quit leaves no orphaned Vite process.

### WS2-4. electron-builder config

Add the missing `build` block to `package.json`:

- `appId`, product name, mac target (dmg + zip).
- A `files` / `extraResources` glob that **ships renderer source + `vite` + the
  runtime node_modules the Vite server needs** — the inversion of a normal
  Electron build, which ships only a bundle.
- Keep `main`/`preload` deps externalized as today (`externalizeDepsPlugin`;
  dugite resolves its embedded git relative to its own files — do not bundle it).
- Acceptance: `bun run dist` produces a launchable `.app` that boots via WS2-2.

### WS2-5. Signing, notarization, entitlements

Required for distribution, not for local self-evolving runs — do it last.

- Hardened-runtime entitlements for spawning child agents and Vite/JIT:
  `com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory`, and
  inherit / `disable-library-validation` so the spawned node/ACP adapters
  (`@zed-industries/claude-agent-acp`, `@agentclientprotocol/codex-acp`) load.
- `afterSign` notarize hook; Developer ID cert + Apple credentials in CI/env.
- Acceptance: notarized build launches on a clean Mac without Gatekeeper blocks
  and can spawn both backends.

**Depends on:** WS2-1 first; then 2-2 → 2-3 → 2-4 → 2-5.

---

## WS3 — Skills enable/disable (optional)

[`SkillsSection`](../src/app/settings/sections/SkillsSection.tsx) is read-only by
design (v1 scope). Enabling/disabling means moving skill files between an active
dir and a staging dir, or maintaining a disabled-list the agent config honors
([skills/list.ts](../electron/main/skills/list.ts)). Self-contained. Only build
if the toggle is actually wanted — otherwise the documented v1 scope stands.

**Depends on:** nothing.

---

## WS4 — Doc reconciliation (continuous, cheap)

- Re-check the stale `- [ ]` boxes in
  [MILESTONE-V1.md:25-34](./MILESTONE-V1.md) — that work shipped; the doc
  misrepresents state.
- After WS2 lands: flip the `TODO(v2)` in
  [dev-server.ts:25](../electron/main/dev-server.ts) and the deferred line in
  [BUILD-PLAN.md](./BUILD-PLAN.md).

**Depends on:** WS2 for the dev-server line; the MILESTONE fix is free now.

---

## Order & critical path

```
WS1-1 (now) ──► WS1-2 ──► WS1-3 ──► WS1-4 (tag v1)      [needs a model turn]
WS2-1 ──► WS2-2 ──► WS2-3 ──► WS2-4 ──► WS2-5            [the long pole]
WS4 (MILESTONE boxes: now) ───────────► WS4 (dev-server line: after WS2)
WS3 (anytime, optional)
```

Do **WS1 first** — it tags `v1` for near-zero cost. Then WS2 starting with the
WS2-1 keystone. WS4 runs alongside; WS3 only if the toggle is wanted.

## Out of scope (carried from MILESTONE-V1)

Auto-update, app store, multi-window, voice, mobile bridge, sandbox hardening
beyond the iframe `sandbox` attribute. Do not let these creep into the packaging
work.
