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

The compiled/native concerns stay in the main process, thin and stable. The
agent evolves the renderer + skills/prompts, never the parts that would need a
rebuild.

```
┌─────────────────────────────────────────────────────────────┐
│  Electron MAIN  (Node — thin, stable, NOT self-edited)       │
│                                                              │
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
│  — self-evolvable surface —  │   │  (claude-agent-acp, codex)│
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
processes, or git. It is the trust boundary. It does NOT contain app feature
logic the agent would want to rewrite.

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

When the agent edits Hearth's own source, three things happen:

1. **Classify the edit** (`path-relevance.ts`) — renderer component → HMR;
   route tree → full reload; main-process file → process restart. Port Stella's
   `path-relevance.ts` classification tiers.
2. **Apply it** (`hmr.ts`) — drive Vite HMR for hot-swappable paths; escalate to
   reload/restart otherwise. Tracks in-flight edits so concurrent agent runs
   don't stomp each other.
3. **Commit it** (`git.ts` via `dugite`) — every self-mod is a git commit tagged
   with the conversation that caused it. "Undo that" → `git revert`. This is the
   safety net; an AI does not rewrite the app without a reversible history.

`self-mod-service.ts` orchestrates the three and exposes `commit` / `revert` to
IPC.

## Micro-apps (`electron/main/micro-apps/` + `templates/micro-app/`)

Distinct from sidebar apps. A micro-app is a **fully standalone Vite + React
app** with its own `package.json`, scaffolded into `micro-apps/<name>/`. It runs
as its **own Vite dev server** and is embedded in the renderer via a
**sandboxed `<iframe>`** pointed at that server.

- `scaffold.ts` — copies `templates/micro-app/` → `micro-apps/<name>/`,
  rewrites placeholders. (Logic mirrors Stella's `create-workspace-app.mjs`.)
- `server.ts` — starts/stops a Vite server per micro-app, returns its URL.

Isolation is the point: a micro-app has its own dependency tree, can't reach
into Hearth's internals, and can't crash the shell. The iframe `sandbox`
attribute is the wall.

## Two kinds of "app" — don't conflate them

| | Sidebar app | Micro-app |
|---|---|---|
| Lives in | `src/app/<id>/` | `micro-apps/<name>/` |
| Part of | Hearth's own bundle | standalone, separate deps |
| Added by | drop a folder + route | `create-app` scaffolder |
| Embedded via | TanStack route | sandboxed `<iframe>` |
| Use it for | first-class Hearth features | sandboxed/generated apps |

## State

Port Stella's **asymmetric request-broadcast**: the renderer requests a state
change over IPC, the main process applies it to the canonical copy and
broadcasts the full state back to all windows. The renderer never applies
optimistically. The active *view* lives in the TanStack router, not in shared
state.

## What we deliberately do NOT do

- No Next.js. SSR is meaningless in a renderer; plain Vite + React.
- No self-modification of compiled/native code. The main process is restartable
  but is not the agent's canvas.
- No hand-rolled ACP framing. Use the SDK.
- No module federation for micro-apps. Standalone server + iframe is simpler and
  safer.
