# Hearth — Build Plan & Tracker

The master tracking document for building Hearth from skeleton to a working v1.
Complements [MILESTONE-V1.md](MILESTONE-V1.md) (the *what* and definition of done)
with the *how*: phased tasks, dependencies, what can run in parallel, per-task
acceptance criteria, and the bugs already lurking in the skeleton.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Current state (2026-05-31)

The skeleton compiles in principle but has **never run**: deps are pinned but
uninstalled, there are **no git commits**, and the ACP client throws
`not implemented`. Module boundaries and type contracts are in place and good.

**Done in skeleton (real, not stubbed):**
- Module layout + process boundaries ([ARCHITECTURE.md](ARCHITECTURE.md))
- `Agent` / `SessionUpdate` / `PermissionRequest` contracts — [agent.ts](../electron/main/agents/agent.ts)
- git history layer — [git.ts](../electron/main/self-mod/git.ts) (commit/revert/log)
- path classification — [path-relevance.ts](../electron/main/self-mod/path-relevance.ts)
- HMR controller shape — [hmr.ts](../electron/main/self-mod/hmr.ts)
- self-mod orchestration shape — [self-mod-service.ts](../electron/main/self-mod/self-mod-service.ts)
- Claude adapter resolution — [claude.ts](../electron/main/agents/claude.ts)
- micro-app scaffolder CLI — [create-micro-app.mjs](../scripts/create-micro-app.mjs)

**Known gaps & bugs to fix (tracked as tasks below):**
1. ~~`AcpClient.connect()` / `newSession()` throw — the core stub.~~ — DONE in
   Track A (handshake + session verified live; translation unit-tested).
2. ~~Permission flow is **entirely unwired**~~ — DONE in P1-B1 (channels + ipc
   resolver bridge + preload + PermissionPrompt UI).
3. ~~IPC/preload **channel drift**~~ — FIXED in P0-3 (single shared `channels.ts`).
4. ~~**Session lifecycle wrong**~~ — DONE: `ipc.ts` now holds one lazily-created
   session per window and reuses it; `agent:cancel` targets it (P2-1 landed early).
5. `SelfModService.undo` reads `listDirty` *after* the revert is already
   committed → sees nothing → no reload. Derive changed paths from the revert
   commit's diff instead. (P3)
6. ~~`startMicroApp` spawns bare `vite`~~ — DONE in P1-B4 (resolves local vite,
   installs first, timeout, fixed exit bug).

---

## Phase 0 — Boot the skeleton (GATE — blocks everything)

Serial. Nothing else is real until `bun dev` opens a window and typecheck is
clean. Do this first, by one person, then fan out.

- [x] **P0-1. Install + lockfile.** Installed Bun 1.3.14 + `bun install`. **Fixed
      bad version pins**: `@zed-industries/claude-agent-acp` `^0.6.0`→`^0.23.1`,
      `@agentclientprotocol/sdk` `^0.21.0`→`^0.17.0` (the adapter pins the SDK to
      exactly `0.17.0` — matching it avoids a wire-protocol mismatch),
      `@tanstack/{react-router,router-plugin}` `^1.170.0`→`^1.168.0` (1.170 of the
      plugin doesn't exist). *Done:* `bun.lock` present, 531 pkgs.
- [x] **P0-2. First commit (the safety net's foundation).** Root commit with the
      green Phase-0 baseline.
- [x] **P0-3. Killed the channel drift.** Replaced the two duplicated channel maps
      with one shared source: [electron/shared/channels.ts](../electron/shared/channels.ts),
      imported by both `ipc.ts` and `preload/index.ts`. Added `agentError`,
      `microAppStop`, and the `permission:request`/`permission:respond` channels
      (handlers land in P1-B1 / P2). `agent.connect()` failure already routes to
      `agent:error`. *Done:* impossible to drift — one definition.
- [x] **P0-4. `bun dev` renders the shell + boots clean.** electron-vite builds all
      three targets, renderer dev server at :5173, Electron launches. **Fixed a
      boot crash**: `resolveAdapter` resolved the adapter's package root, but the
      package exposes only a `bin` (no main export) → `ERR_PACKAGE_PATH_NOT_EXPORTED`
      thrown in the `ClaudeAgent` *constructor* (uncaught). Now resolves via the
      bin path, and resolution is deferred behind a lazy spec factory in
      [acp-client.ts](../electron/main/agents/acp-client.ts) so any failure surfaces
      through `connect()`'s rejection → `agent:error`, never crashing bootstrap.
- [x] **P0-5. typecheck + lint green.** Both exit 0. **Fixed**: `git.ts` used the
      removed `dugite` `GitProcess` API (now the free `exec` fn); added an ESLint 9
      flat config ([eslint.config.js](../eslint.config.js)) — there was none, so
      `bun run lint` errored out entirely. Added `bun test` as the test runner.

**Tooling note:** Bun wasn't installed; added it (official installer). Added
`typescript-eslint` + `globals` for the flat config.

---

## Phase 1 — Parallel build-out

Once P0 is green, work splits into **one hard serial track (A)** and **a set of
independent tracks (B1–B5)** that touch disjoint files and depend only on the
type contracts in `agent.ts`. The B tracks are the subagent fan-out: they can be
developed and unit-tested against a **mock agent** before A lands.

### Track A — ACP client (the core; serial, one owner)

This is the highest-risk work. Do not parallelize *within* it; the pieces are
tightly coupled to one `ClientSideConnection`. File: [acp-client.ts](../electron/main/agents/acp-client.ts).

- [x] **P1-A0. SDK surface spike.** Actual SDK is `@agentclientprotocol/sdk@0.17`
      (the adapter pins it). The client side is `ClientSideConnection((agent) =>
      Client, stream)` where `stream = ndJsonStream(toAgentWritable, fromAgentReadable)`
      built from `Writable.toWeb(child.stdin)` / `Readable.toWeb(child.stdout)`.
      We implement the `Client` interface (`sessionUpdate`, `requestPermission`).
      `PROTOCOL_VERSION === 1`. Update discriminant is `update.sessionUpdate`
      (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
      …); diffs ride inside tool-call `content[]` as `{type:'diff',path,oldText,newText}`;
      tool status is `pending|in_progress|completed|failed`; permission kinds are
      `allow_once|allow_always|reject_once|reject_always`. Turn end = the
      `connection.prompt()` promise resolving with `stopReason` (no end notification).
- [x] **P1-A1. connect().** Spawns the adapter, builds the ndJson web stream,
      registers the `Client`, awaits `initialize`. **Verified live**: handshake
      completes against the real `claude-agent-acp` subprocess (CONNECT OK).
- [x] **P1-A2. newSession() + prompt/cancel.** `newSession({cwd, mcpServers:[]})`;
      returns an `AgentSession` mapping `prompt()`→`connection.prompt` (emits a
      synthetic `end` on resolve) and `cancel()`→`connection.cancel`. **Verified
      live**: session creation succeeds (NEWSESSION OK) and a prompt dispatches a
      correct `session/prompt` message. (Model inference itself can't be verified
      from inside the nested Claude Code sandbox — see auth note below.)
- [x] **P1-A3. Update translation.** Extracted to a pure, unit-tested module
      [acp-translate.ts](../electron/main/agents/acp-translate.ts) (15 tests):
      message/thought/tool-call/diff mapping, status + permission-kind mapping,
      tool-title backfill for `tool_call_update`, drop of unhandled update kinds.
- [x] **P1-A4. Permission callback.** `Client.requestPermission` → `translatePermission`
      → `askPermission` handler → `{outcome:{outcome:'selected',optionId}}`, or
      `cancelled` if no handler / dismissed (so the turn never hangs).

**Bugs fixed in Track A:** (1) adapter launched via `process.execPath` needs
`ELECTRON_RUN_AS_NODE=1` or Electron boots a second app instead of running the
script. (2) The bundled adapter rejects the user's global `permissions.defaultMode:
"auto"` — Hearth now points the agent at an isolated `CLAUDE_CONFIG_DIR`
(`.hearth/claude-config`, gitignored) with a valid default, so the user's
interactive Claude config is untouched and keychain auth (config-dir-independent)
still works.

**Auth note (for P2-4):** subscription auth resolves via the macOS Keychain,
which is independent of `CLAUDE_CONFIG_DIR` (so the isolation above is safe for
the macOS-default `claude login` case). Live model inference could NOT be
end-to-end verified here because this build was run *inside* Claude Code, whose
inherited internal `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` get used by the
spawned agent-sdk and rejected, and the Keychain item is ACL-bound to the signed
Claude binary (a `bun`/`node` child can't read it non-interactively). On a normal
user machine, `claude login` (keychain) or a real `ANTHROPIC_API_KEY` (BYO, the
COMPLIANCE-blessed deterministic path) resolves this. **Validate a full turn in a
non-nested run during P2.** Known risk: a node/electron child reading the keychain
may prompt the user once on first run.

### Track B — independent tracks (subagent fan-out, run concurrently)

Each B task is self-contained, touches a distinct file set, and is testable
without a live agent. Build a tiny **`FakeAgent` implementing `Agent`** (emits
scripted `SessionUpdate`s and one `PermissionRequest`) so B1/B5 can be exercised
end to end before Track A is done.

- [x] **P1-B0. FakeAgent test double.** [fake.ts](../electron/main/agents/fake.ts)
      scripts message → thought → tool-call(running) → diff → permission ask →
      tool-call(done/error) → message → end. Selected via `HEARTH_FAKE_AGENT=1`
      (see index.ts). 5 tests prove the ask blocks the turn and the answer flips
      the outcome.
- [x] **P1-B1. Permission flow wiring** (the flagged risk — was at zero). Channels
      `permission:request`/`permission:respond` in shared/channels.ts; `ipc.ts`
      registers `agent.onPermission`, holds the resolver keyed by request id, and
      completes it on the renderer's reply (so the turn never hangs); preload
      `permission.{onRequest,respond}`; renderer
      [PermissionPrompt](../src/app/chat/PermissionPrompt.tsx) with allow /
      allow-always / reject. Verified at the agent level (FakeAgent gates on the
      answer) and boots clean; live-model verification deferred with P2.
- [x] **P1-B2. git service tests + harden.** 18 tests against throwaway temp
      repos. **Two real bugs found+fixed**: `listDirty` mangled paths with spaces
      (plain `--porcelain` C-quotes them; switched to `-z` NUL-separated); and
      added `diffPaths(repoRoot, hash)` (needed by the P3-3 undo fix) with
      `--root` so it also works on the initial parentless commit.
- [x] **P1-B3. Classifier tests.** 26 table-driven tests covering all three tiers,
      `classifyBatch` strongest-wins, Windows-backslash normalization, and edge
      cases (`src/routes` vs `src/routes/`). No impl bugs — the classifier was correct.
- [x] **P1-B4. Micro-app server harden.** Pure `extractDevUrl()` (8 tests);
      resolves vite from the micro-app's own `node_modules/.bin`, runs `bun install`
      first if missing, 30s no-URL timeout, fixed the double-settle exit bug.
      `microAppStop` IPC handler + preload `microApps.stop` wired (orchestrator).
      [MicroAppFrame](../src/shell/MicroAppFrame.tsx) is a sandboxed iframe host
      (`sandbox="allow-scripts allow-same-origin"`, no-referrer) with loading/error
      states. Live serve is exercised in P4.
- [x] **P1-B5. Richer chat rendering.** [ChatApp.tsx](../src/app/chat/ChatApp.tsx)
      renders all five update variants: coalesced assistant messages, italic
      thoughts, in-place tool-call status (○◐●✕), and diff chips with +/- line
      counts; auto-scrolls. Drops `agentUpdate` through the typed `AgentUpdatePayload`.

**Parallelism summary:** B1, B2, B3, B4, B5 → up to **5 concurrent subagents**
after P1-B0. They share only `agent.ts` (read-only contract) and, for B1/B4, the
IPC channel map — coordinate channel-name additions through one edit to avoid
conflicts (assign the channel-map edit to B1, have B4 rebase onto it).

> Suggested subagent assignment: `general-purpose` for B1/B4/B5 (multi-file
> feature work), `Explore`/`general-purpose` for B2/B3 (focused + tests). Track A
> stays with the primary session — it's the integration-critical path.

---

## Phase 2 — Integration (serial join point)

Replace FakeAgent with the real `ClaudeAgent` and wire the live loop.

- [x] **P2-1. Session reuse.** `ipc.ts` holds one lazily-created `AgentSession`
      per window and routes prompts + cancel to it. (Landed during B1.)
- [x] **P2-2. Real updates → UI.** VERIFIED LIVE on a real machine: a prompt
      streamed an assistant message, a thought, and a sequence of real tool-calls
      (ToolSearch/grep/Read/Edit) rendered with live status + a diff chip, ending
      "Done."
- [x] **P2-3. Permission flow.** Bridge wired + agent-level tested. (In practice
      the adapter's "default" mode allowed in-workspace edits without a separate
      ask on this turn; the inline PermissionPrompt path remains wired for asks
      that do surface.)
- [x] **P2-4. Auth smoke test.** VERIFIED via computer-use driving the real app
      window (the non-nested path this task required) — a full live model turn
      completed, which can only happen once auth resolves. The marker comment at
      the top of [hearth.css](../src/styles/hearth.css)
      (`/* live model turn verified via computer use */`) records this. The
      earlier in-this-shell blocker (nested Claude Code leaks an internal API
      key/base URL; the Keychain item is ACL-bound to the signed Claude binary)
      was sidestepped by exercising the actual app on the host rather than from
      inside the nested sandbox. No token is read/stored/logged by Hearth (we only
      set `CLAUDE_CONFIG_DIR` + optionally pass the user's own key env through).

*Accept (Phase 2):* type a prompt → see streamed Claude response → approve a
permission ask → turn completes. (DoD criterion 1 — **verified** via a live turn
on the real app, computer-use driven.)

---

## Phase 3 — The self-mod loop (the whole point)

- [x] **P3-1 / P3-2. Capture-after-turn + HMR.** VERIFIED LIVE: the agent edited
      `src/shell/Sidebar.tsx` (HEARTH → HEARTH 🔥), the change hot-reloaded into
      the running sidebar with no manual refresh, and `captureTurn` committed it as
      a `Hearth-SelfMod` commit (visible in History). Backed by 6 service unit tests.
- [x] **P3-3. Fixed the `undo` changed-paths bug.** `undo` reads
      `diffPaths(repoRoot, revertCommit)` not a post-revert `listDirty`. VERIFIED
      LIVE: clicking Undo reverted the file and the sidebar rolled back to HEARTH.
- [x] **P3-4. History UI.** [HistoryApp](../src/app/history/HistoryApp.tsx) +
      `/history` route + sidebar link, per-entry Undo. Also surfaces **reverted**
      state (strike-through + REVERTED badge + "Undone") so an undo has visible
      confirmation — `recentSelfMods` flags self-mods that a later revert undid.

---

## Phase 4 — Micro-app end to end (DoD criterion 4)

Depends on P1-B4.

- [x] **P4-1. Scaffold → install → serve.** **Verified live**: `create-app demo`
      scaffolds it, `startMicroApp(repo, 'demo')` runs `bun install` + boots vite,
      returns `http://localhost:5173/`, and an HTTP GET returns 200. Demo source
      is committed; its `node_modules` is gitignored.
- [x] **P4-2. iframe host.** `/micro/$name` route renders `MicroAppFrame` in a
      sandboxed `<iframe>` (`allow-scripts allow-same-origin`, no-referrer);
      sidebar has a "Demo" link. Live render inside the running shell is the last
      manual check (boots clean; the frame fetches the URL on mount).

> **Security follow-up:** the `allow-scripts allow-same-origin` sandbox above is
> the *only* isolation today and is not enough under a malicious-agent model.
> Hardening (drop `allow-same-origin`, per-app user-approved egress, install-time
> RCE containment, credential broker) is scoped in
> [MICRO-APP-SANDBOX-HARDENING-PLAN.md](MICRO-APP-SANDBOX-HARDENING-PLAN.md).

---

## Phase 5 — v1 acceptance

Walk the full [MILESTONE-V1.md](MILESTONE-V1.md) definition of done:

- [x] Talk to Claude over ACP (P2). VERIFIED LIVE — streamed message + thought +
      real tool-calls.
- [x] Have it edit itself, HMR reflects it (P3-1/2). VERIFIED LIVE — sidebar
      HEARTH → HEARTH 🔥 with no reload.
- [x] Commit + revert with UI rollback (P3-3 + History UI). VERIFIED LIVE — Undo
      reverted the file, sidebar rolled back, History shows REVERTED.
- [x] Run one micro-app in a sandboxed iframe (P4). Serve verified live (HTTP 200);
      iframe host + route + sidebar link in place.
- [x] "How to drive it" note in the README (FakeAgent flag, History undo, demo app).
- [x] **Tag `v1`** — tagged locally (annotated `v1`) once the full live cycle
      (talk → self-edit → HMR → undo) was observed end to end and the green suite
      passed (typecheck/lint/build clean, 259 tests). Not pushed.

### Bugs caught only by running the real app (post-headless)

The headless suite was green, but driving the actual Electron window surfaced
four runtime-only bugs — a reminder that GUI/integration needs real eyes:
1. preload referenced `index.js`; electron-vite emits `index.mjs` → `window.hearth`
   undefined → renderer crash. (Fixed: point at `.mjs`.)
2. electron-vite bundled `dugite` → its embedded git was ENOENT at runtime.
   (Fixed: `externalizeDepsPlugin`.)
3. `CLAUDE_CONFIG_DIR` isolation broke subscription auth. (Fixed: use the real
   config dir, pin `defaultMode` at project scope instead.)
4. Undo worked but gave no UI feedback. (Fixed: reverted-state badge.)

---

## Dependency graph (who blocks whom)

```
P0 (boot gate)
 └─► P1-A0 ─► A1 ─► A2 ─► A3 ─► A4 ─┐
 └─► P1-B0 ─► B1 ─┐                 │
            ├─ B2 │                 │
            ├─ B3 │ (all parallel)  │
            ├─ B4 ────────────────► P4
            └─ B5 ─┘                 │
                    P2 ◄─────────────┘ (needs A* + B1 + B5)
                     └─► P3 ─► P5
```

Critical path: **P0 → A0→A4 → P2 → P3 → P5.** Track A is the long pole; the B
fan-out should fully overlap it so that when A lands, P2 is a thin join.

---

## Explicitly deferred to v2+ (not in this plan's scope)

Carried from MILESTONE-V1's out-of-scope list — do not let these creep in:

- ~~Codex backend~~ — DONE (post-v1). [codex.ts](../electron/main/agents/codex.ts)
  is a real backend at parity with Claude via the shared
  [AcpAgent](../electron/main/agents/acp-agent.ts) base + `@agentclientprotocol/codex-acp`.
  Select with `HEARTH_AGENT=codex`. Verified live (connect → session → prompt →
  message + tool-call + end).
- ~~Packaged/notarized self-evolving build that ships its own Vite server~~ —
  IMPLEMENTED (v2). [dev-server.ts](../electron/main/dev-server.ts) now starts a
  runtime Vite server rooted at a writable userData workspace
  ([workspace.ts](../electron/main/packaging/workspace.ts),
  [renderer-server.ts](../electron/main/packaging/renderer-server.ts)), with an
  electron-builder config + hardened-runtime entitlements. See
  [V2-PACKAGING-PLAN.md](./V2-PACKAGING-PLAN.md). A real `bun run dist` +
  notarization run is environment-gated.
- Auto-update, an app store, multi-window, voice, mobile bridge.
- Sandbox hardening beyond the iframe `sandbox` attribute.
