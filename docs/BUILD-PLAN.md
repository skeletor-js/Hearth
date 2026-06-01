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
1. `AcpClient.connect()` / `newSession()` throw — the core stub. (P1-A)
2. Permission flow is **entirely unwired** end to end: `agent.onPermission` is
   never registered in `ipc.ts`, no IPC channel, no preload API, no UI. (P1-B1)
3. ~~IPC/preload **channel drift**~~ — FIXED in P0-3 (single shared `channels.ts`).
4. **Session lifecycle wrong**: `agent:prompt` creates a new session per prompt
   instead of reusing one. (P0-3 / P2)
5. `SelfModService.undo` reads `listDirty` *after* the revert is already
   committed → sees nothing → no reload. Derive changed paths from the revert
   commit's diff instead. (P3)
6. `startMicroApp` spawns bare `vite` with no install step / no resolution. (P1-B4)

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

- [ ] **P1-A0. SDK surface spike.** Pin `@agentclientprotocol/sdk@0.21` and
      `@zed-industries/claude-agent-acp@0.6`; read their actual exports. Confirm
      `ClientSideConnection` constructor shape, the initialize handshake, the
      `session/update` notification names, and the `requestPermission` callback
      signature. Write findings into a short note (these move between minors).
- [ ] **P1-A1. connect().** Wire `ClientSideConnection` to `child.stdout/stdin`,
      register update + permission callbacks, await `initialize`. *Accept:*
      `connect()` resolves against a live `claude-agent-acp` subprocess.
- [ ] **P1-A2. newSession() + prompt/cancel.** `connection.newSession({ cwd })`;
      return an `AgentSession` mapping `prompt()`/`cancel()` onto ACP calls.
      *Accept:* a prompt produces streamed updates; cancel stops the turn.
- [ ] **P1-A3. Update translation.** Map ACP `session/update` payloads →
      `SessionUpdate` union (message / thought / tool-call / diff / end).
      *Accept:* each variant round-trips to the renderer with correct shape.
- [ ] **P1-A4. Permission callback.** Route the SDK `requestPermission` to
      `this.askPermission(...)` → `PermissionHandler`. *Accept:* a mid-turn
      permission ask reaches the handler and the agent waits for the answer.

### Track B — independent tracks (subagent fan-out, run concurrently)

Each B task is self-contained, touches a distinct file set, and is testable
without a live agent. Build a tiny **`FakeAgent` implementing `Agent`** (emits
scripted `SessionUpdate`s and one `PermissionRequest`) so B1/B5 can be exercised
end to end before Track A is done.

- [ ] **P1-B0. FakeAgent test double.** Implements `Agent`; scripts a turn:
      message → tool-call(running→done) → diff → permission ask → end. Unblocks
      B1 and B5. *Files:* `electron/main/agents/fake.ts` (dev-only).
- [ ] **P1-B1. Permission flow wiring** (the flagged risk). Add IPC channels
      (`permission:request` main→renderer, `permission:respond` renderer→main),
      register `agent.onPermission` in `ipc.ts` to bridge them, add the preload
      API, and build the renderer prompt UI (allow / allow-always / reject).
      *Files:* ipc.ts, preload/index.ts, a renderer `PermissionPrompt` component.
      *Accept:* against FakeAgent, a permission ask renders, the chosen option id
      flows back, and the agent's promise resolves.
- [ ] **P1-B2. git service tests + harden.** Unit-test commit/revert/log against
      a temp repo; verify the `Hearth-SelfMod` trailer grep and conversation
      trailer parsing. *Files:* git.ts (+ test). *Accept:* tests green; trailer
      round-trips.
- [ ] **P1-B3. Classifier tests.** `path-relevance.ts` is pure — exhaustively
      test the three tiers and `classifyBatch` (strongest-wins). *Files:* test
      only. *Accept:* table-driven tests cover renderer/route/main/config paths.
- [ ] **P1-B4. Micro-app server harden.** Resolve `vite` from the micro-app's own
      `node_modules` (run `bun install` on first start, or use Vite's
      programmatic `createServer`); handle the no-URL-printed timeout; expose
      `microAppStop` over IPC. *Files:* micro-apps/server.ts, scaffold.ts, ipc.ts.
      *Accept:* `startMicroApp` returns a live URL for a freshly scaffolded app.
- [ ] **P1-B5. Richer chat rendering.** Render thoughts, tool-call status
      transitions, and diffs (not just `message`/`end`) in ChatApp, driven by the
      FakeAgent stream. *Files:* ChatApp.tsx (+ small subcomponents).
      *Accept:* every `SessionUpdate` variant has a visible representation.

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

- [ ] **P2-1. Session reuse.** Hold one `AgentSession` per window instead of
      `newSession()` per prompt; route prompts/cancels to it. *Files:* ipc.ts.
- [ ] **P2-2. Real updates → UI.** Confirm Track A's `SessionUpdate`s render via
      the B5 chat UI over the real stream.
- [ ] **P2-3. Real permission asks → UI.** Confirm B1's flow answers real
      mid-turn `requestPermission` calls from Claude.
- [ ] **P2-4. Auth smoke test.** With a locally `claude login`'d CLI
      (subscription mode) AND with `ANTHROPIC_API_KEY` (BYO), per
      [COMPLIANCE.md](COMPLIANCE.md). *Accept:* both paths complete a turn; no
      token is read, stored, or logged by Hearth.

*Accept (Phase 2):* type a prompt → see streamed Claude response → approve a
permission ask → turn completes. (DoD criterion 1.)

---

## Phase 3 — The self-mod loop (the whole point)

- [ ] **P3-1. Capture-after-turn live.** `captureTurn` commits the agent's edits
      with the conversation trailer after a real turn. *Accept:* "change the
      sidebar title to X" → a `Hearth-SelfMod` commit appears.
- [ ] **P3-2. HMR reflects the edit.** Renderer-tier edit hot-reloads live with
      no manual reload; a route/main edit escalates correctly. *Accept:* the
      title change shows without restart. (DoD criterion 2.)
- [ ] **P3-3. Fix `undo` changed-paths bug.** Derive changed paths from the
      revert commit's diff (`git show --name-only <revertHash>`), not a post-revert
      `listDirty`. Then apply the right reload tier. *Files:* self-mod-service.ts,
      git.ts (add a `diffPaths(hash)` helper). *Accept:* "undo that" reverts the
      last self-mod and the UI rolls back via HMR. (DoD criterion 3.)
- [ ] **P3-4. History UI.** Surface `selfMod.history()` (recent self-mods) with a
      per-entry undo button. *Files:* a renderer history panel.

---

## Phase 4 — Micro-app end to end (DoD criterion 4)

Depends on P1-B4.

- [ ] **P4-1. Scaffold → install → serve.** `create-app demo` then
      `microAppStart('demo')` boots its Vite server and returns a URL.
- [ ] **P4-2. iframe host.** `MicroAppFrame` embeds the URL in a sandboxed
      `<iframe>`; verify isolation (it can't reach `window.hearth`). *Accept:*
      the demo app renders inside the shell, sandboxed.

---

## Phase 5 — v1 acceptance

Walk the full [MILESTONE-V1.md](MILESTONE-V1.md) definition of done in one
sitting:

- [ ] Talk to Claude over ACP (P2).
- [ ] Have it edit itself, HMR reflects it (P3-1/2).
- [ ] Commit + revert with UI rollback (P3-3).
- [ ] Run one micro-app in a sandboxed iframe (P4).
- [ ] Tag `v1` and write a short "how to drive it" note in the README.

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

- Codex backend ([codex.ts](../electron/main/agents/codex.ts) stays a stub;
  interface already defined).
- Packaged/notarized self-evolving build that ships its own Vite server
  ([dev-server.ts](../electron/main/dev-server.ts) `TODO(v2)`).
- Auto-update, an app store, multi-window, voice, mobile bridge.
- Sandbox hardening beyond the iframe `sandbox` attribute.
