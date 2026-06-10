# Working in Hearth

Hearth is a self-evolving desktop client for coding agents. When you run inside
it, **this repo is the running app** and you may be asked to change its own UI.

- The renderer (`src/**`) is served by a live Vite dev server, so your edits
  **hot-reload into the running app** — no restart needed.
- Avoid editing `electron/main/**` and `electron/preload/**` unless the task truly
  needs it: those restart the whole app.
- Your edits are auto-committed as `Hearth-SelfMod` git commits and are revertable
  from the app's History view, so make focused changes.

## Seeing and controlling the live app

Hearth gives you MCP tools (server `hearth`) to both **see** and **drive** the
running app — anything the user could do. The window itself isn't visible to you,
so use these.

See:
- `view_app()` — screenshot the current screen. `view_app({ path: "/history" })`
  renders+captures a specific route in a hidden window (doesn't disturb the user's
  view). Always look after a UI change before claiming it works.
- `read_ui()` — list interactive elements (buttons/links/inputs) with their text
  and a CSS selector. Use it to find what to act on.

Control:
- `click({ text: "Send" })` or `click({ selector: "..." })`
- `fill({ selector: "input", value: "...", submit: true })`
- `eval_js({ code: "..." })` — run arbitrary JS in the renderer. It has the DOM and
  `window.hearth` (every IPC: `agent.prompt`, `selfMod.undo`, `microApps.start`,
  `agent.setBackend`, …). Make the final expression return something serializable.

A good loop: `read_ui` (or `view_app`) to orient → `click`/`fill`/`eval_js` to act
→ `view_app` to confirm.

Shell fallback for screenshots: `node scripts/view-app.mjs [route]` saves a PNG to
`.hearth/snapshot.png`. (The raw dev URL `http://localhost:5173` will NOT render
outside the app — it needs the preload bridge.)

## Design (keep Hearth's UI coherent)

Reuse the design system; don't invent a parallel one.

- **Use tokens, never hardcode.** Pull from `src/styles/hearth.css`: `var(--bg)`,
  `var(--bg-panel)`, `var(--strong)`/`var(--subtle)`/`var(--faint)` for text,
  `var(--accent)`, `var(--border)`/`var(--border-strong)`, the `--t-*` type scale,
  `var(--font)`/`var(--mono)`. They flip with theme — hardcoded hex won't.
- **Reuse the vocabulary.** Existing classes (`btn`, `card-row`, `chip`, `screen`,
  `wb-*`, `dot ok|warn|err`) and the Phosphor `<Icon name=…>` set. Don't mix in a
  different icon family or a one-off button style for a single screen.
- **No AI slop.** Don't pile cards on cards, sprinkle gradients/badges/emoji to fill
  space, or add affordances that aren't earned. Quiet, spacious, intentional.
- **Use the full canvas** on app pages; don't float a tiny modal-like card in empty
  space. **Human copy** — no exposed jargon, no em dashes, no decorative restating.

## Parallel subagents

If you spawn parallel subagents to edit Hearth, **give each subagent a disjoint set
of files.** Two subagents editing the same file race on disk (last writer wins) — if
work must share a file (e.g. both touch `src/routes/__root.tsx`), do it sequentially
or assign it to one subagent. Hearth groups a turn's commits by file so disjoint work
is independently undoable; overlapping work merges into one commit.

## Validation

After editing renderer or main-process code, run `bun run typecheck`. Restart-tier
edits (`electron/**`, configs) are typechecked automatically before the app restarts;
a failure is surfaced rather than bricking the app.

## Project knowledge

- `docs/solutions/` — documented solutions to past problems (bugs, best practices,
  workflow patterns), organized by category with YAML frontmatter (`module`, `tags`,
  `problem_type`). Relevant when implementing or debugging in documented areas.
- `CONCEPTS.md` — shared domain vocabulary (entities, named processes, status
  concepts). Relevant when orienting to the codebase or discussing domain concepts.

## Live-view semantics (important for view_app)

- **Single-agent edits** hot-reload into the live app immediately — your normal
  `view_app` verify-as-you-go loop works as usual.
- **During parallel-subagent work**, the live UI is held at its pre-turn state and
  swaps in atomically when the parallel phase finishes (so the user never sees a
  half-applied, flickering, or crashing UI). So mid-parallel-phase, `view_app` shows
  the OLD UI — verify your edits by reading files / running typecheck, not by
  screenshotting, until the phase completes.
