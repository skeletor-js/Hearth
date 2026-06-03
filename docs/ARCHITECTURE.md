# Hearth — Architecture

A self-evolving macOS desktop client for coding agents (Claude Code, Codex)
driven over the Agent Client Protocol (ACP).

The design borrows directly from [Stella](https://github.com/ruuxi/stella)
(Apache-2.0), which is a working reference for this exact class of app. Where a
problem is already solved well there, we say "port from Stella" rather than
reinvent.

## The one idea everything hangs on

**The renderer is the product, and the renderer is editable at runtime.**

Electron's main process is Node, the renderer is a Vite-served web app. Because
the renderer is served by a *live Vite dev server* — not a frozen bundle — an
agent can edit renderer source on disk and the change hot-reloads into the
running UI. Self-evolution is not a feature we build; it falls out of running
the app as its own dev environment.

The renderer hot-reloads, so it's the agent's *primary* canvas. But the agent
isn't fenced to it: it may edit anything in the repo — `electron/main`, preload,
config, deps included — **except** a hard-blocked denylist (secrets, system
paths, internal state) and a small protected safety-net island. Main-process
edits can't hot-reload, so they ride a guarded path (blocking typecheck + a boot
watchdog that auto-reverts a boot-breaking edit). Safety comes from
*recoverability*, not from fencing the agent out. See
[the self-evolution engine](#the-self-evolution-engine-electronmainself-mod) and
[SELF-MOD-HARDENING-PLAN.md](completed-plans/SELF-MOD-HARDENING-PLAN.md).

```
┌─────────────────────────────────────────────────────────────┐
│  Electron MAIN  (Node — editable but guarded;               │
│                  self-mod/ island stays inviolable)          │
│  window mgmt ── ipc ── dev-server (serves renderer)          │
│       │                                                       │
│       ├── agents/      ACP client → Claude Code / Codex       │
│       ├── self-mod/    git (dugite) + HMR controller          │
│       └── micro-apps/  scaffold + per-app Vite servers        │
└───────────────┬──────────────────────────────┬──────────────┘
                │ IPC (preload bridge)          │ spawns
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│  RENDERER (React, Vite)      │   │  Agent subprocesses       │
│  — primary canvas (hot) —    │   │  (claude-agent-acp, codex)│
│                              │   └──────────────────────────┘
│  routes/   TanStack file     │
│  app/      sidebar apps      │   ┌──────────────────────────┐
│  shell/    layout/chrome     │   │  Micro-app Vite servers   │
│            └─ <iframe> ──────┼──▶│  micro-apps/<name>/       │
│  components/ lib/ styles/    │   │  (sandboxed, standalone)  │
└──────────────────────────────┘   └──────────────────────────┘
```

## Process boundaries (who owns what)

**Main process** owns everything that touches the OS, credentials, child
processes, or git. It is the trust boundary. It *is* editable by the agent
(guarded — see self-evolution below), but a **protected island** within it —
`electron/main/self-mod/`, the boot watchdog, and the recovery anchor — is
inviolable and dependency-isolated, so the agent can never disarm its own
guardrails even while rewriting the rest of main.

- `electron/main/index.ts` — app lifecycle, creates the window, wires services.
- `electron/main/window.ts` — BrowserWindow creation, macOS chrome.
- `electron/main/dev-server.ts` — resolves the renderer URL. In dev that is
  electron-vite's server. The packaged self-evolving build ships a Vite server
  and writes its URL to `.vite-dev-url` (port Stella's `dev-url.ts`).
- `electron/main/ipc.ts` — the only surface the renderer can call. Every channel
  is explicit and validated.
- `electron/main/agents/` — the ACP layer (see below).
- `electron/main/self-mod/` — the self-evolution engine (see below).
- `electron/main/micro-apps/` — scaffolding + lifecycle for embedded apps.
- `electron/main/routines/` — scheduled-task store + scheduler (see below).

**Preload** (`electron/preload/index.ts`) — `contextBridge` exposing a narrow,
typed `window.hearth` API. `contextIsolation` on, `nodeIntegration` off.

**Renderer** (`src/`) — all UI and feature logic. Hot-reloadable. Self-edited.

## The ACP layer (`electron/main/agents/`)

One `Agent` interface, multiple backends. The renderer never knows which model
it is talking to — it sends prompts and renders a stream of ACP updates.

- `agent.ts` — the `Agent` interface + session/update types.
- `acp-client.ts` — wraps `@agentclientprotocol/sdk` `ClientSideConnection`:
  spawn the adapter subprocess, speak JSON-RPC over its stdio, surface
  `session/update` notifications, and answer permission requests.
- `acp-agent.ts` — the shared `AcpAgent` base + `resolveAdapterBin`. A backend is
  just "which adapter bin + which credential"; everything else is identical.
- `claude.ts` — spawns `@zed-industries/claude-agent-acp` (vendors Claude Code).
- `codex.ts` — spawns `@agentclientprotocol/codex-acp` (vendors `@openai/codex`).
  At full parity with Claude — same client, same translation. Select with
  `HEARTH_AGENT=codex`.

**Auth stays the user's.** Hearth spawns the agent the user already
authenticated (`claude login` / `codex login` in their own environment). We never render the
Claude OAuth screen and never store a token. This is what keeps us in the
"editor driving Claude Code" lane rather than the prohibited "third-party app
routing requests through a subscription" lane. See docs/COMPLIANCE.md.

## The self-evolution engine (`electron/main/self-mod/`)

**Scope first.** A write guard (port of Stella's `isBlockedPath`) splits the repo
into three tiers: *hard-blocked* (secrets, system dirs, internal state — never
writable), the *protected island* (the self-mod engine, boot watchdog, recovery
anchor, hook config — editable only with explicit user approval, dependency-
isolated from editable code), and the *canvas* (everything else, including the
rest of `electron/main`). Writes route through Hearth (ACP `fs` capability) so
the guard is a real choke point; shell writes that bypass it are forced back onto
the mediated path (a `PreToolUse` hook on Claude, permission-reject on Codex) and
caught by a file-watch backstop.

When the agent edits a canvas path, four things happen:

1. **Classify the edit** (`path-relevance.ts`) — renderer → HMR; route tree/html
   → full reload; main/preload/config → process restart. Port Stella's tiers.
2. **Apply it** (`hmr.ts` + a snapshot-overlay Vite plugin) — single-writer edits
   hot-swap immediately; the moment **2+ subagents write concurrently**, the
   overlay pins their pre-edit baselines and swaps the whole batch in atomically,
   so the live UI never shows a half-applied state. Restart-tier edits run a
   **blocking typecheck** first and refuse to restart if it fails.
3. **Commit it** (`git.ts` via `dugite`) — a turn becomes **file-disjoint
   commits** (one per subagent group), grouped by a `Hearth-Run` trailer. Undo is
   Model A net-effect `git revert`; History shows the logical timeline.
4. **Recover if it breaks** — a main-anchored crash surface (the renderer can't
   be the only net since main is editable) offers Reload / Repair / Undo, with one
   guarded auto-repair; a **boot watchdog** auto-reverts a main edit that bricks
   startup. An async typecheck after canvas edits surfaces type breakage.

`self-mod-service.ts` orchestrates these and exposes `commit` / `revert` to IPC.
Full design + rationale in [SELF-MOD-HARDENING-PLAN.md](completed-plans/SELF-MOD-HARDENING-PLAN.md).

## Micro-apps (`electron/main/micro-apps/` + `templates/micro-app/`)

Distinct from sidebar apps. A micro-app is a **fully standalone Vite + React
app** with its own `package.json`, scaffolded into `micro-apps/<name>/`. It runs
as its **own Vite dev server** and is embedded in the renderer via a
**sandboxed `<iframe>`** pointed at that server.

- `scaffold.ts` — copies `templates/micro-app/` → `micro-apps/<name>/`, rewrites
  placeholders, and optionally overlays a **starter** (`templates/starters/<id>/App.tsx`
  — a one-file variant, so starters carry no boilerplate). `listStarters` /
  `listMicroApps` back the **Tools** gallery (`src/routes/tools.tsx`).
- `server.ts` — starts/stops a Vite server per micro-app, returns its URL.

Two ways a micro-app is born: **new from a starter** in the Tools gallery, or
**Save as tool** from a chat — which scaffolds an empty app, then has the agent
build it from the conversation (only on the Hearth self-session, where the agent's
file tools can reach `micro-apps/`).

Isolation is the point: a micro-app has its own dependency tree, can't reach
into Hearth's internals, and can't crash the shell. The iframe `sandbox`
attribute is the wall.

## Routines (`electron/main/routines/`)

Standing tasks the agent runs on a schedule (a morning brief, a daily digest).
The key constraint: there is **one shared agent host**, and driving it headlessly
would collide with an interactive turn. So main never runs an agent turn for a
routine — it only **schedules and notifies**:

- `schedule.ts` — pure schedule math (`computeNextRun` / `dueRoutines` /
  `validateSchedule`). No I/O; fully unit-tested.
- `store.ts` — persists routine definitions under userData, keeping `nextRunAt`
  in sync on create / enable / fire.
- `scheduler.ts` — a thin timer that finds due routines, advances their schedule
  (`markRan` *before* notifying, so a closed/busy app drops a fire rather than
  storming it), and emits `routine:due` to the renderer.

The **renderer** executes a due routine through the same proven path as a History
revert handoff: start a session in the routine's workspace and queue the prompt
(`useRoutineRunner` in `src/app/routines/`). Consequences, by design: routines fire
**only while Hearth is open**, the agent runs on the normal interactive path, and a
routine can never affect boot or collide with the trusted core.

## Two kinds of "app" — don't conflate them

| | Sidebar app | Micro-app |
|---|---|---|
| Lives in | `src/app/<id>/` | `micro-apps/<name>/` |
| Part of | Hearth's own bundle | standalone, separate deps |
| Added by | drop a folder + route | `create-app` scaffolder |
| Embedded via | TanStack route | sandboxed `<iframe>` |
| Use it for | first-class Hearth features | sandboxed/generated apps |

## Workspace kind (code vs knowledge)

A session carries a **kind** that frames the workbench. It's inferred at creation
(Hearth and any git repo → `code`; a plain folder → `knowledge`) and flippable per
session, persisted on the session record.

- `code` shows the full developer workbench: Files, Terminal, Git, Review, Self,
  Agents, Plan.
- `knowledge` drops the dev seams and shows **Sources** (real connector status from
  `mcp.active()`, plus one-tap digests routed to the agent — Hearth doesn't broker
  connector data, so nothing is fetched or faked here), Files, a doc surface, and Plan.

The tab set is a pure function of kind (`selectWorkbenchTabs` in
`src/app/workbench/WorkPanel.tsx`), so the framing is one switch, not a fork.

## State

Port Stella's **asymmetric request-broadcast**: the renderer requests a state
change over IPC, the main process applies it to the canonical copy and
broadcasts the full state back to all windows. The renderer never applies
optimistically. The active *view* lives in the TanStack router, not in shared
state.

## What we deliberately do NOT do

- No Next.js. SSR is meaningless in a renderer; plain Vite + React.
- No *unguarded* self-modification of main/native code, and no agent writes to
  the protected safety-net island or the secrets/system denylist. Main is
  editable, but only behind the boot watchdog + blocking typecheck; the island and
  denylist are off-limits.
- No hand-rolled ACP framing. Use the SDK.
- No module federation for micro-apps. Standalone server + iframe is simpler and
  safer.
