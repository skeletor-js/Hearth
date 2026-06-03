# Hearth

A self-evolving macOS desktop client for coding agents — Claude Code (and Codex)
driven over the [Agent Client Protocol](https://agentclientprotocol.com). It can
edit its own UI at runtime, like [Stella](https://github.com/ruuxi/stella).

> Status: v1 verified, with a knowledge-worker layer on top. The ACP client,
> permission flow, self-mod commit/undo, HMR classification, and micro-app serving
> are implemented, and the core talk → self-edit → HMR → undo loop is verified
> live (see the note below). Gate: typecheck, eslint, 368 tests, and a clean build
> are green. The newer knowledge-worker surfaces — **Tools**, **Routines**,
> **Sources**, and code/knowledge workspaces — are implemented and unit-tested; the
> routine live-firing path (scheduler → renderer → agent) is not yet confirmed
> against a live model.

## How it works

- **Electron main** (Node, thin, stable) owns windows, the ACP client, git, and
  micro-app servers. It is never self-edited.
- **The renderer** (React + Vite) is the product and is hot-reloadable, so an
  agent editing its source changes the running app live.
- **Self-mods are git commits** (via dugite) — every agent edit is versioned and
  revertible.
- **Micro-apps** are standalone Vite apps embedded in sandboxed iframes.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. Auth rules — which keep
this on the right side of Anthropic's terms — are in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Layout

```
electron/main/      thin, stable host process
  agents/           ACP layer — one Agent interface, Claude + Codex backends
  self-mod/         git history + HMR apply (the self-evolution engine)
  micro-apps/       scaffold + per-app Vite servers
  routines/         scheduled-task store + scheduler (emits "due" to renderer)
electron/preload/   the narrow window.hearth bridge
src/                the self-evolvable renderer
  routes/           TanStack file-based routes (chat, tools, routines, …)
  app/              sidebar apps (chat) + workbench tabs (files, sources, …)
  shell/            layout + iframe micro-app host
templates/micro-app standalone micro-app template (the "blank" starter)
templates/starters  one-file starters overlaid on the template (tracker, board, log)
scripts/            create-micro-app CLI
```

## Develop

Requires [Bun](https://bun.sh) and a locally-authenticated agent — Claude Code
(`claude login`) or Codex (`codex login`). Hearth drives *your* agent, it never
handles your credentials.

```bash
bun install
bun dev                        # electron-vite: opens the app with live HMR (Claude)
HEARTH_AGENT=codex bun dev     # same app, Codex backend
bun test                       # tests: ACP translation, git, classifier, self-mod, adapters, fake agent
bun run typecheck && bun run lint
bun run create-app demo        # scaffold a micro-app (already scaffolded in this repo)
```

Backends: Claude (default) and Codex are interchangeable — both ride the same ACP
client, so streaming, tool-calls, diffs, and the permission flow behave
identically. Select with `HEARTH_AGENT`. Auth is the user's own: `claude login` /
`ANTHROPIC_API_KEY` for Claude, `codex login` / `OPENAI_API_KEY` for Codex.

Driving it:

- Open **Chat**, type a request. Hearth sends it to your local agent over ACP and
  streams the reply; mid-turn permission asks appear inline (allow / always / reject).
- Self-edits land as `Hearth-SelfMod` git commits. **Changes** lists them with an
  Undo button (`git revert` + the right HMR reload tier).
- **Tools** is the micro-app gallery: start one from a starter template, or turn
  any chat into a tool with **Save as tool** (scaffolds + has the agent build it).
- **Routines** are standing tasks the agent runs on a schedule (e.g. a morning
  brief). Main tracks the schedule and emits "due"; the renderer runs the prompt,
  so routines fire only while Hearth is open and the reply lands in chat.
- A session has a **kind** — `code` (the developer workbench: files, terminal,
  git, review) or `knowledge` (Sources + docs), inferred from the workspace and
  flippable per session.
- `HEARTH_FAKE_AGENT=1 bun dev` runs a scripted agent (no model) to exercise the
  chat + permission UI without auth — useful for UI work.

Permission mode: the agent defaults to **auto** (auto-accept edits). Override with
`HEARTH_PERMISSION_MODE` — e.g. `HEARTH_PERMISSION_MODE=default bun dev` to be
prompted for every edit, or `plan`/`acceptEdits`/`bypassPermissions`. Hearth pins
the resolved mode at project scope (`.claude/settings.local.json`, gitignored)
because the bundled adapter can't parse newer modes like `auto` directly.

> Verified live on macOS with `claude login`: talk → self-edit → HMR → undo works
> end to end. Auth uses your existing Claude login (keychain) or a BYO
> `ANTHROPIC_API_KEY` — Hearth never stores a credential.

## License

Intended: Apache-2.0 (matches Stella, whose self-mod engine this borrows from).
Add a LICENSE file before distributing.
