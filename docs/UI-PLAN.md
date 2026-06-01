# Hearth — UI Build Plan (the real product UI)

Target: build the Hearth UI from the Claude Design handoff (mirrored in
[design/handoff/](../design/handoff/) — read `Hearth.html` for the full design-token
+ CSS system, then the `hearth-*.jsx` components). This supersedes the minimal v1
shell. v1 plumbing ([BUILD-PLAN.md](BUILD-PLAN.md)) — ACP client, permission flow,
self-mod, backend switch, agent see/control MCP — stays; this plan re-skins the
renderer to the handoff and adds the backends the new UI implies.

## The founding principle (read this first)

**Hearth is ONE app, ONE repo, and it is self-modifiable.** That never changes.

**Self-evolution is a GLOBAL capability, available from every session** — not a
property of a particular workspace. From any session, whatever folder it's working
in, the user can ask Hearth to change itself; that edits Hearth's own repo,
commits a `Hearth-SelfMod`, and HMR-reloads the running app. So the "Self-edit"
chip, the **Self** workbench tab, and **History** are always present.

**"Workspaces" are other local folders** the user opens. A workspace only sets the
**task cwd** for a session — the folder the agent reads/edits for the *task*. The
agent there behaves like a normal coding agent (diffs, files, terminal). It is NOT
a separate "place" where self-evolution does or doesn't happen.

Two distinct file scopes per turn, tracked independently:

| Scope | What it is | What happens to edits |
|---|---|---|
| **Hearth repo** (`REPO_ROOT`) | the running app's own source | self-mod commit → **HMR reload**, lands in History. Watched after *every* turn, any session. |
| **Session workspace** (`cwd`) | the folder the task is in (may equal `REPO_ROOT`) | normal git working-tree edits, shown in Review. No auto-commit, no HMR. |

A turn usually touches one scope; occasionally both (e.g. "fix this bug in
project X *and* add a button to yourself"). Mechanism:

- A session is `{ workspace, cwd, transcript }`. ACP's `newSession({ cwd })` already
  takes a cwd; today we hardcode `REPO_ROOT`. Multi-workspace = sessions whose cwd
  is the opened folder.
- The agent is always told **where Hearth's own source lives** (an absolute path +
  the self-edit instructions), injected into every session's context — so it can
  self-edit regardless of its cwd.
- `captureTurn` runs against `REPO_ROOT` after every turn: if Hearth's source
  changed → self-mod commit + HMR; if not → no-op. Independent of the session cwd.

If a session's own cwd *is* `REPO_ROOT`, the two scopes coincide — that's just
"working on Hearth directly," a normal case, not a special mode.

---

## Architecture decisions

1. **Port the handoff CSS as Hearth's design system.** The prototype's `Hearth.html`
   is a complete, polished token + component-class system (~770 lines). Fastest
   path to pixel-perfect is to lift the `:root` tokens + component classes into the
   renderer's global stylesheet (`src/styles/`), and build React components against
   those class names. Tailwind v4 stays available for incidental utility, but the
   design-system classes lead. Add Phosphor icons (`@phosphor-icons/web`, thin +
   fill — the prototype uses them).
2. **Keep the architecture; restyle within it.** Keep TanStack file routes — each
   top-level screen (session/home/history/search/workspaces/settings) is a route
   file; the handoff *shell* (rail + topbar + workbench cards) becomes the
   `__root` layout. Keep Zustand for shared UI state (theme, layout, panels,
   active workspace/session). This preserves the "drop a route file = new view"
   self-mod seam AND delivers the design.
3. **Agent cwd becomes per-session.** `AcpClient`/`AgentHost` stop hardcoding
   `REPO_ROOT` as the task cwd; the active session carries its workspace cwd. The
   agent is also told `REPO_ROOT` (Hearth's own source) so it can self-edit from
   any session.
4. **Self-mod is global and `REPO_ROOT`-scoped.** `captureTurn` watches `REPO_ROOT`
   after *every* turn, in every session → self-mod commit + HMR if Hearth's source
   changed, no-op otherwise. The session's own-cwd edits (when cwd ≠ REPO_ROOT) are
   the task's normal output — shown in Review, not auto-committed. (We already snapshot
   dirty-before/after; extend it to watch REPO_ROOT independent of the session cwd.)
5. **The agent can still see/drive this UI** via the existing `view_app` /
   `read_ui` / `click` / `fill` / `eval_js` MCP tools — they get richer here.
6. **It's all in `src/`** → still hot-reloadable and self-editable. The new UI is
   itself something Hearth can evolve.

---

## Capability map — every UI surface → backend status

Legend: ✅ wired today · 🟡 partial / needs IPC · 🆕 net-new subsystem

| UI surface (handoff source) | Backend today | Work needed |
|---|---|---|
| Shell: floating cards, rail, topbar, resizers, themes (light/dark, 4 accents), layouts (companion/split/focus) | renderer-only | Port CSS + components; Zustand for layout/theme state. ✅-able now |
| Chat: messages, tool-strips, **agent-trace timeline**, thinking ember, run line | ACP stream (`onUpdate`: message/thought/tool-call/diff/end) | Map stream → trace timeline + strips. Mostly ✅; trace grouping is presentation |
| Composer (branch chip, self-edit chip, mode seg plan/auto/ask, send/stop) | `agent.prompt`/`cancel` | Wire; modes → permission/plan mode. 🟡 |
| Approve card | `permission.onRequest/respond` | Re-skin to the approve card. ✅ |
| Backend picker popover + Agents screen (models, connect ACP) | `agent.getBackend/setBackend` (claude/codex) | Popover ✅; per-model select + arbitrary ACP connect 🆕 |
| History: timeline, undo, **redo**, undone state, current-build boundary | `selfMod.history/undo` (+ reverted flag) | Undo ✅; **redo** (revert-the-revert) 🆕; boundary UI 🟡 |
| Workbench · **Review** (diff) | `diffPaths` only | `getDiff(cwd, rev?)` → structured hunks IPC. 🟡 |
| Workbench · **Self** (self-edit files + apply) | self-mod + control | Wire to self-mod; always available (global self-evolution). 🟡 |
| Workbench · **Files** (tree) | none | `fs` IPC: read dir tree + file under workspace cwd. 🆕 |
| Workbench · **Terminal** | none | PTY in main (node-pty) streamed to xterm.js. 🆕 (largest) |
| Workbench · **Browser** (url bar + preview) | none | Electron `WebContentsView` pointed at a URL; nav controls. 🆕 |
| Workbench · **Plan** (checklist) | ACP `plan` updates (currently dropped) | Capture `plan` session updates → plan store → UI. 🟡 |
| **Workspaces** (open folders, branch/status, tree in rail, detail screen) | single repo only | Workspace registry + open-folder dialog + git branch/status. 🆕 |
| **Sessions** (multiple per workspace, recents, rename/dup/export/archive/delete, persisted transcripts) | one ephemeral session | Session store (persist transcripts + metadata) + lifecycle. 🆕 |
| ⌘K command palette | none | Build over routes/skills/workspaces actions. 🆕 (UI) |
| Home / New session (starters, continue, workspaces) | none | Build screen over the above data. 🟡 |
| Search (sessions by title/message) | none | Search the session store. 🆕 (after sessions) |
| Settings (account, agent, appearance, **personality→soul.md**, **memory**, self-evolution toggles) | theme + permission mode | Appearance ✅; personality/soul.md 🆕; memory file 🆕; toggles 🟡. **Shape TBD** |
| Onboarding (connect agent / choose workspace / personality / ready) | none | Build + first-run state. **Shape TBD** |

---

## New backend subsystems (design notes)

- **Workspaces** (`electron/main/workspaces/`): a registry persisted to app data —
  the built-in Self workspace (REPO_ROOT) plus user-opened folder paths. Open via
  Electron `dialog.showOpenDialog`. Per-workspace git branch + dirty status (dugite,
  which we already use). IPC: `workspaces.list/open/remove/status`.
- **Sessions + persistence** (`electron/main/sessions/`): sessions belong to a
  workspace; persist transcript (the `SessionUpdate[]` + user turns) + metadata
  (title, created, last-active, self?). IPC: `sessions.list/create/get/rename/
  duplicate/archive/delete/export`. The renderer's chat reads/writes here, so
  switching sessions restores the transcript. Agent turns route to the session's
  workspace cwd.
- **Agent cwd per session + self-edit reach:** thread `cwd` from session →
  `AgentHost.prompt` → `AcpClient.newSession({cwd})`. Keep a connected adapter;
  create/reuse ACP sessions per (workspace,session). Inject Hearth's own repo path
  + self-edit instructions into every session's context so the agent can modify
  Hearth from anywhere. `captureTurn` always targets `REPO_ROOT`. Revisit
  `pinProjectPermissionMode`/`CLAUDE_CONFIG_DIR` so folder workspaces don't get
  Hearth's pins written into them (isolate config for non-Hearth cwds, or respect
  their own).
- **Diff/Review** (`getDiff`): structured hunks for a workspace's working tree (or a
  commit), built on dugite. Feeds the Review tab + History "Diff".
- **Files** (`fs` IPC): sandboxed dir-tree + file read rooted at the active
  workspace cwd. Feeds the Files tab.
- **Terminal** (`node-pty` + xterm.js): a real PTY per panel, cwd = workspace.
  Biggest new piece; also unblocks the Browser "dev server" story.
- **Browser** (`WebContentsView`): an embedded web view with back/reload/url/open;
  points at a workspace's dev server or arbitrary URL.
- **Plan:** capture ACP `plan` session updates (we currently drop them in
  `acp-translate`) into a per-session plan; render in the Plan tab + the chat
  plan-ref chip.
- **Personality / soul.md + Memory:** Settings "personality" choices compile to a
  `soul.md` the agent reads; "memory" opens a local `memory.md`. Both are files in
  the Self repo / config dir. **Shape TBD with you.**
- **History redo:** today undo = `git revert`. Redo = revert-the-revert (or
  `reset` within a Hearth-managed evolution log). Define the model before building
  the undo/redo toolbar.

---

## Phases

Each phase ends green (typecheck/lint/build/tests) with a checkpoint commit.
"∥" marks tracks that can run as parallel subagents.

### P0 — Design system + shell (foundation)
- Port tokens + component CSS from `Hearth.html` into `src/styles/`. Add Phosphor.
- Build the shell as `__root`: floating-cards frame, **rail** (brand, nav,
  workspaces tree, recent, footer, collapse), **topbar** (crumbs, session ⋯ menu,
  panel toggles), **resizers**, themes + 4 accents, the three layouts. Zustand for
  theme/layout/panel/rail state. FlameMark + AsciiEmber + ThinkingEmber.
- *Accept:* the empty shell renders pixel-close in light + dark, resizes, toggles
  layouts — no data yet.

### P1 — Chat, wired (the core loop, re-skinned)
- Re-skin chat to the handoff: messages, tool-strips, **agent-trace timeline**,
  composer (modes, chips, send/stop), approve card — all wired to the real ACP
  stream, permission flow, and backend switch. Replace today's minimal ChatApp.
- *Accept:* a live turn renders as the trace timeline; permission → approve card;
  Claude/Codex switch in the composer/popover.

### P2 — Workbench: Review + Plan + Self  ∥
- ∥ **Review/diff:** `getDiff` IPC + DiffView (per-file hunks), Review subhead.
- ∥ **Plan:** capture ACP `plan` updates + Plan tab + chat plan-ref.
- ∥ **Self tab:** self-edit file list + Apply, wired to self-mod. Always available
  (global self-evolution), in any session. *(Open Q: distinct tab vs folded into Review.)*
- Workbench shell (right + bottom panels, tabs, add-tab menu, resizers) lands here.

### P3 — Workspaces + Sessions (the big new model)  ∥ within
- Workspace registry + open-folder + git status; rail tree + Workspaces/Workspace
  screens; Home screen.
- Session store + persistence; session lifecycle (rename/dup/export/archive/
  delete); per-session cwd threaded to the agent; Recents; switching restores
  transcript.
- ∥ Search (over the session store) once sessions exist.
- *Accept:* open a second folder, start a session in it, agent edits there (cwd
  correct, no HMR); from that same session, ask Hearth to change itself → self-mod
  commit + HMR fires (REPO_ROOT-scoped), proving self-evolution works from any session.

### P4 — Files / Terminal / Browser  ∥
- ∥ Files tab (`fs` IPC + tree).
- ∥ Terminal tab (node-pty + xterm.js).
- ∥ Browser tab (WebContentsView + controls).

### P5 — Settings, Personality/Memory, Agents, History redo  ∥
- ∥ Settings screen (appearance ✅, agent, command-approval → permission mode,
  self-evolution toggles). **Confirm shape.**
- ∥ Personality → soul.md; Memory file. **Confirm shape.**
- ∥ Agents screen (per-model select; connect arbitrary ACP server).
- ∥ History redo + current-build boundary.

### P6 — ⌘K palette, onboarding, polish
- ⌘K command palette (nav/skills/workspaces/theme). Toasts, context menus,
  popovers. Onboarding flow + first-run state. **Confirm onboarding shape.**

---

## Parallelization

P0 and P1 are the serial spine (everyone needs the design system + shell, then the
core chat). After that, the workbench tabs (P2/P4), the screens (P3/P5), and
palette/onboarding (P6) are largely independent and map cleanly to parallel
subagents — partitioned by route/component file, sharing only the design-system
CSS (read-only) and a small set of IPC channels (coordinated through one
`channels.ts` edit, as in v1). The big serial dependency is **P3 (workspaces +
sessions)**: Files/Terminal/Browser/Review all operate on "the active workspace
cwd," so the workspace/session model should land before those are fully wired
(they can be built against the Self workspace first, then generalized).

---

## Open questions (flagged by you + surfaced here)

1. **"Self" workbench tab** — keep it as a distinct, always-present tab (the
   self-evolution view), or fold the self-edit/apply affordance into Review?
   (Default: keep, always available since self-evolution is global.)
2. **Settings shape** — the handoff settings (account, personality→soul.md, memory,
   self-evolution toggles, command approval) are a proposal. Which sections are
   real for v1 vs later? `soul.md` / `memory.md` semantics?
3. **Onboarding shape** — keep the 4-step (agent/workspace/personality/ready), or
   trim? When does it show (true first run only)?
4. **History redo semantics** — revert-the-revert vs a managed evolution log with
   real backward/forward. Affects the undo/redo toolbar.
5. **Session persistence scope** — persist full transcripts across restarts now, or
   start with in-memory + metadata and add disk persistence later?
6. **Folder-workspace permission/config** — for non-Self folders, do we pin a
   permission mode / isolate `CLAUDE_CONFIG_DIR`, or respect the folder's own
   `.claude` settings?
