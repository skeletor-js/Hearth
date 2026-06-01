# Hearth

A self-evolving macOS desktop client for coding agents — Claude Code (and Codex)
driven over the [Agent Client Protocol](https://agentclientprotocol.com). It can
edit its own UI at runtime, like [Stella](https://github.com/ruuxi/stella).

> Status: skeleton. The architecture and module boundaries are in place; the hard
> seams (ACP client, HMR apply) are stubbed with `TODO(v1)` and the build order
> is in [docs/MILESTONE-V1.md](docs/MILESTONE-V1.md).

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
bun dev            # electron-vite: opens the app with live HMR
bun run create-app demo   # scaffold a micro-app
```

> Not yet verified end-to-end — deps are pinned but uninstalled in this
> skeleton, and the ACP client / HMR apply are stubbed. See the milestone doc.

## License

Intended: Apache-2.0 (matches Stella, whose self-mod engine this borrows from).
Add a LICENSE file before distributing.
