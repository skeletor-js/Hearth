# Hearth Knowledge-Worker Workspace Plan

> **Status: ACTIVE (drafted 2026-06-02).** Not started. Designed for `/goal`:
> each workstream (W#) is sized to land as one focused, independently-revertable
> `Hearth-SelfMod` commit, in order. Run the global gate after every W#.

## Why this plan

Hearth today is, by its code, a **coding-agent IDE**: the workbench is Files /
Terminal / Git / Review (git diff) / Self / Plan, chat rides ACP to Claude Code
or Codex, and self-mods are git commits. That is a strong developer tool.

The product goal is an **IDE for knowledge workers** — people who already have a
Claude Code / Codex subscription but want a flexible, customizable workspace. The
gap is not capability; it is that the surface is dev-shaped and the real wedge is
buried. The wedge is **persistent generated software**: a user asks for a tool,
walks away with a real one fed by their real data, still there tomorrow. The
bones already exist (self-evolution, micro-apps, connectors, soul + memory) — this
plan reshapes the surface around that wedge and makes it legible to a non-developer.

Four threads, sequenced by risk and dependency:

1. **Reframe & legibility** (renderer-only, lowest risk) — make the existing
   machinery understandable and trustworthy to a non-dev. Do first so everything
   after it reads correctly.
2. **Micro-apps as the core output** (mostly renderer) — promote generated tools
   from a dev demo to the product's central noun.
3. **Workspace types & knowledge surface** (renderer + light main) — hide the dev
   seams behind a workspace `kind`; add knowledge-worker surfaces.
4. **Background routines** (`electron/main`; restart) — scheduled / long-running
   agents. Biggest payoff, most main-process work, landed last on firm ground.

## Conventions

Renderer-only changes (`src/**`) hot-reload. Anything under `electron/main/**`
or `electron/preload/**` **restarts the app** — flagged per item.

**Global verification gate (after every workstream):**
`bun run typecheck && bun run lint && bun test`. Phase-specific manual checks
inline. Keep each W# to one commit so History/Undo stays clean.

**Positioning rule (applies throughout):** lead with "it becomes your workspace,"
never "the app edits its own code." Self-editing is the engine, not the headline.

---

## Phase 1 — Reframe & legibility (renderer-only)

Cheap, hot-reloads, makes the rest of the product legible to the target user.

### W1 — History → "Changes", plain-language entries [LOW]
Files: `src/app/history/History.tsx` (renderer; HMR)
- Replace commit/SHA/revert vocabulary with plain English. The sub-line at
  `History.tsx:12` ("…lands here as a commit. Undo reverts it…") becomes
  user-facing: "Everything Hearth changes about itself shows up here. Undo to
  roll it back."
- Keep the `SelfModKind` filter (code / soul / memory) and the Undo/Redo buttons.
  Surface the human title; demote the 7-char hash to a hover/detail affordance,
  not the primary label.
- The conflict-handoff path (`History.tsx:69-78`) keeps the hash internally — only
  the presentation changes, not the git mechanics.
- Test: existing History tests stay green; manual — open History, confirm no raw
  "commit"/"revert" copy in the default view.
- Risk: low (copy + presentation only).

### W2 — Plain-language permission prompts [LOW]
Files: `src/app/chat/ChatView.tsx` (renderer; HMR), new
`src/app/chat/permission-verbs.ts`
- The permission request handler is at `ChatView.tsx:277`. Add a small mapper that
  turns a `PermissionRequest` (tool name + `req.category` + args) into a human
  sentence: e.g. an email-send tool → "Hearth wants to send an email to Jordan."
- `permission-verbs.ts` holds a category/tool → verb-phrase map; unknown tools
  fall back to the current raw display so nothing is hidden, just humanized.
- Keep the existing allow / always / reject options and the auto-mode logic
  (`ChatView.tsx:284`) exactly as-is — only the rendered label changes.
- Test: unit-test the mapper (known tool → sentence; unknown tool → raw fallback).
  Manual with `HEARTH_FAKE_AGENT=1` to drive a permission ask.
- Risk: low.

### W3 — Trust panel in Settings [LOW]
Files: `src/app/settings/sections/` (new `TrustSection.tsx`), wire into the
settings route (renderer; HMR)
- A readable "What Hearth can and can't do" page: sandboxed renderer, authenticated
  bridge, cwd confinement to registered workspaces, scheme allowlist, secret
  scrubbing — i.e. surface the W1-W18 hardening as a feature, not invisible plumbing.
- Static, sourced from `docs/SECURITY-HARDENING-PLAN.md`. No new IPC.
- Test: typecheck/lint; manual — section renders in Settings.
- Risk: low.

### W4 — Positioning copy pass [LOW]
Files: `src/shell/Onboarding.tsx`, `src/routes/index.tsx`, `src/routes/new.tsx`,
`src/shell/Rail.tsx` brand area (renderer; HMR)
- Soften the self-editing headline everywhere it greets a new user. Lead with the
  workspace-that-shapes-to-you framing; move "self-evolving / edits its own code"
  to a secondary "how it works" position.
- No behavior change — copy and emphasis only.
- Test: manual — read the onboarding and home empty-states end to end.
- Risk: low.

---

## Phase 2 — Micro-apps as the core output

Promote generated tools from `micro-apps/demo` to the product's central noun. The
"save this chat as a tool" loop is the highest-wedge slice; build it first.

### W5 — "Save as tool" action on a chat turn [MEDIUM]
Files: `src/app/chat/ChatView.tsx`, `src/shell/MicroAppFrame.tsx`,
possibly `electron/preload/index.ts:251` (`microApps`) + a main scaffold IPC
(renderer; **may touch main/preload → restart**)
- Add a "Save as tool" affordance on an assistant turn that produced a working
  artifact. It scaffolds from `templates/micro-app` (reuse
  `scripts/create-micro-app.mjs` logic) and opens via the existing
  `window.hearth.microApps.start(name)` path (`MicroAppFrame.tsx:36`).
- The agent writes the app body from the chat context into `micro-apps/<name>`.
  If a `microApps.create/scaffold` IPC does not yet exist alongside `start`, add
  it in preload + main (flag restart for that commit).
- Test: scaffold + start a named tool; assert it loads in `MicroAppFrame`. Reuse
  the existing micro-app sandbox tests as a guard.
- Risk: medium (crosses renderer↔main if a new scaffold IPC is needed — keep that
  in this one commit and smoke-test).

### W6 — Tools gallery [LOW]
Files: new `src/routes/tools.tsx`, `src/shell/Rail.tsx` (renderer; HMR)
- A gallery of saved micro-apps: name, last-used, and the connectors each touches.
  Lists `micro-apps/*`. Promote a "Tools" rail entry above History.
- Test: manual — gallery lists the demo app + any tool saved via W5.
- Risk: low.

### W7 — Seed tool templates [LOW]
Files: new dirs under `templates/` (renderer-served; HMR)
- 3-4 starter micro-apps that demonstrate the knowledge-worker value: meeting-prep
  board (Fireflies / Granola), content calendar, lightweight tracker, CRM-lite
  (Notion). These are the first-run "wow."
- Each is a standalone template the gallery (W6) can offer as "new from template."
- Test: scaffold each template; confirm it boots in the sandbox.
- Risk: low.

---

## Phase 3 — Workspace types & knowledge surface

Branch the workbench on a workspace `kind` so a non-dev never sees a git diff.

### W8 — Workspace `kind` on the session model [MEDIUM]
Files: `src/app/session-store.ts` (`ActiveSession`, line ~13), session creation in
`src/routes/new.tsx`, and the workspace registry if `kind` must persist
(`electron/main/workspaces/registry.ts` — **restart if touched**)
- Add `kind: 'code' | 'knowledge'` to `ActiveSession`. Default existing/unspecified
  sessions to `'code'` so nothing changes for current users.
- Set `kind` at session/workspace creation (the Hearth repo → `code`; a folder a
  knowledge worker opens → ask or infer, default `knowledge`).
- Test: existing session-store tests green; new session carries the right `kind`.
- Risk: medium (persistence path may cross into main → flag restart for that part).

### W9 — Kind-aware workbench tabs [LOW]
Files: `src/app/workbench/WorkPanel.tsx` (`WB_TABS` line 16, `ALWAYS_TABS` line 28,
tab filter line 88) (renderer; HMR)
- Make the tab set a function of `kind`:
  - `code` → today's set (Files, Terminal, Git, Review, Plan, Self).
  - `knowledge` → Sources, Docs/Canvas, Tables, Plan, Tools — hide Terminal / Git /
    Review.
- Refactor `ALWAYS_TABS` + the `needed(t.id)` filter to consult `kind` (depends on W8).
- Test: render WorkPanel for each kind; assert no Terminal/Git tab in `knowledge`.
- Risk: low (pure presentation branch).

### W10 — Sources tab (read-only connector feed) [MEDIUM]
Files: new `src/app/workbench/SourcesTab.tsx`, wired into `WB_TABS` (renderer; HMR,
but reads connector data via existing MCP/IPC)
- A "today across your tools" feed from connected sources (Slack / Gmail / Calendar
  / Fireflies). Read-only first: a unified list, no actions. This is what turns
  Hearth into a daily driver instead of a task tool.
- Reuse the existing connector auth (`connectors-catalog.ts`); do not add new auth.
- Test: with a connector authed, the feed renders items; with none, a clear empty
  state. Manual.
- Risk: medium (depends on connector data access shape — confirm read path before
  building; keep read-only to bound scope).

### W11 — Docs / Canvas surface [LOW]
Files: promote `src/app/workbench/ScratchpadTab.tsx` into a fuller doc surface, or
new `DocsTab.tsx` reusing `markdown-live.ts` (renderer; HMR)
- A real writing/canvas surface for the `knowledge` workbench, building on the
  existing scratchpad + live-markdown rendering. Knowledge workers live in docs.
- Test: manual — edit a doc, confirm live render + persistence via existing
  scratchpad store.
- Risk: low.

---

## Phase 4 — Background routines (`electron/main`; restart)

Scheduled / long-running agents — the capability that makes Hearth feel like a
team, not a chat box. Biggest payoff, most main-process work. There is no cron /
routine primitive in `electron/main` today, so this is net-new and restarts the app.

### W12 — Routine model + scheduler in main [HIGH]
Files: new `electron/main/routines/` (model + scheduler), `electron/main/ipc.ts`,
`electron/preload/index.ts` (**main + preload; restart**)
- A routine = `{ id, prompt, schedule, workspace, output }`. Main owns the
  scheduler (node timers / cron); the renderer only manages definitions. Persist
  definitions to disk under `.hearth/`.
- On fire, run the prompt through the existing ACP agent path against the routine's
  workspace; route output to the target (a doc, or a toast via `src/shell/toast.tsx`).
- Reuse the agent bridge auth + cwd-confinement guards already in place — routines
  must obey the same workspace boundaries as interactive sessions.
- Test: unit-test the schedule evaluation (next-fire calc) as a pure function;
  integration with the fake agent (`HEARTH_FAKE_AGENT=1`) to fire a routine and
  assert output lands. Manual: define a routine, confirm it fires.
- Risk: high (new long-running subsystem in the trusted core; restarts the app).
  Land the scheduler + one wired routine together and smoke-test before building UI.

### W13 — Routines management surface [LOW]
Files: new `src/routes/routines.tsx`, `src/shell/Rail.tsx` (renderer; HMR)
- List / create / pause routines; show last run + its output. Talks to the W12 IPC.
- Test: manual — create and pause a routine; see last-run state.
- Risk: low (UI over W12).

### W14 — "Morning brief" template routine [MEDIUM]
Files: a shipped routine definition + its output target (renderer + main config)
- The canonical first routine: pull calendar + Slack + inbox each morning, write a
  brief to a doc (W11) or surface it as a toast. Proves the end-to-end loop and is
  the demo that sells the persona.
- Test: manual end-to-end — schedule it, let it fire (or trigger manually), confirm
  the brief is produced from connector data.
- Risk: medium (depends on W10 connector reads + W11 doc surface + W12 scheduler).

---

## Dependencies (build order matters)

```
W1  W2  W3  W4              (Phase 1 — independent, any order)
        │
W5 ─→ W6 ─→ W7              (W5 first; gallery + templates follow)
        │
W8 ─→ W9                    (kind on model, then tab branch)
W8 ─→ W10                   (Sources tab consumes kind)
        W11                 (independent doc surface)
        │
W12 ─→ W13                  (scheduler, then its UI)
W10 + W11 + W12 ─→ W14      (morning brief needs all three)
```

## Open questions (resolve before the dependent W#)

- **W8:** how is `kind` chosen for a folder workspace — asked at open, or inferred
  (presence of a `.git` → `code`)? Default proposed: infer, default `knowledge`,
  let the user flip it.
- **W10:** what is the actual read path for connector data in the renderer today —
  direct MCP tool calls, or a main-side aggregator? Confirm before building the feed.
- **W12:** do we reuse the available `scheduled-tasks` MCP / cron tooling, or own a
  node-side scheduler in main? Owning it in main keeps routines inside Hearth's
  trust + workspace-confinement boundary; prefer that unless there's a strong reason.
- **W14:** brief output target — a generated doc (W11) or a notification, or both?

## Out of scope (deliberately deferred)

- Multi-user / sharing of shaped workspaces as templates (the "dotfiles for a PM"
  distribution loop). Real, but a later plan once the single-user surface lands.
- Writing actions from the Sources feed (reply, schedule, send). W10 is read-only
  on purpose; actions are a follow-up with their own permission UX.
