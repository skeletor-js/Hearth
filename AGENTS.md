# Working in Hearth

Hearth is a self-evolving desktop client for coding agents. When you run inside
it, **this repo is the running app** and you may be asked to change its own UI.

- The renderer (`src/**`) is served by a live Vite dev server, so your edits
  **hot-reload into the running app** — no restart needed.
- Avoid editing `electron/main/**` and `electron/preload/**` unless the task truly
  needs it: those restart the whole app.
- Your edits are auto-committed as `Hearth-SelfMod` git commits and are revertable
  from the app's History view, so make focused changes.

## Visually verifying UI changes

You can't see the Electron window directly, but you can capture it. Always do this
for tasks about appearance, layout, or styling — don't claim a visual change works
without looking at it.

**Preferred: the `view_app` tool.** Hearth gives you an MCP tool `view_app` that
returns a screenshot of the live, hot-reloaded app. Call it with no arguments to
see the current screen, or pass a route to inspect a specific one:

- `view_app()` — current view
- `view_app({ path: "/history" })` — the History view
- `view_app({ path: "/chat" })`, `view_app({ path: "/micro/demo" })`, etc.

**Fallback (shell):** `node scripts/view-app.mjs [route]` saves the same PNG to
`.hearth/snapshot.png` for you to read — e.g. `node scripts/view-app.mjs /history`.

(The raw dev URL `http://localhost:5173` will NOT render correctly outside the
app — it needs Electron's preload bridge. Use `view_app` instead.)
