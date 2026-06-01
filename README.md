# Hearth

A self-evolving macOS desktop client for coding agents — Claude Code (and Codex)
driven over the [Agent Client Protocol](https://agentclientprotocol.com). It can
edit its own UI at runtime, like [Stella](https://github.com/ruuxi/stella).

> Status: v1 wired and tested. The ACP client, permission flow, self-mod
> commit/undo, HMR classification, and micro-app serving are implemented with 78
> passing tests; build/typecheck/lint are green and the app boots. The one thing
> not yet confirmed end to end is a **live model turn** (talk → self-edit → HMR),
> blocked only by this build's sandbox auth — see the auth note and full task
> tracker in [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

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
electron/preload/   the narrow window.hearth bridge
src/                the self-evolvable renderer
  routes/           TanStack file-based routes (drop a file = new view)
  app/              sidebar apps (e.g. chat)
  shell/            layout + iframe micro-app host
templates/micro-app standalone micro-app template
scripts/            create-micro-app CLI
```

## Develop

Requires [Bun](https://bun.sh) and a locally-authenticated Claude Code
(`claude login`) — Hearth drives *your* agent, it never handles your
credentials.

```bash
bun install
bun dev                        # electron-vite: opens the app with live HMR
bun test                       # 78 tests (ACP translation, git, classifier, self-mod, fake agent)
bun run typecheck && bun run lint
bun run create-app demo        # scaffold a micro-app (already scaffolded in this repo)
```

Driving it:

- Open **Chat**, type a request. Hearth sends it to your local Claude over ACP and
  streams the reply; mid-turn permission asks appear inline (allow / always / reject).
- Self-edits land as `Hearth-SelfMod` git commits. **History** lists them with an
  Undo button (`git revert` + the right HMR reload tier).
- **Demo** (under Micro-apps) boots a standalone Vite app in a sandboxed iframe.
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
