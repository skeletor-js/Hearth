# Hearth — UI Build Plan & Tracker (the real product UI)

Target: build the Hearth UI from the Claude Design handoff (mirrored in
[design/handoff/](../design/handoff/) — read `Hearth.html` for the full token + CSS
system, then the `hearth-*.jsx` components). Supersedes the minimal v1 shell. v1
plumbing ([BUILD-PLAN.md](BUILD-PLAN.md)) — ACP client, permission flow, self-mod,
backend switch, agent see/control MCP — stays; this re-skins the renderer and adds
the backends the new UI implies.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Founding principle

**Hearth is ONE app, ONE repo, and it is self-modifiable.** Self-evolution is a
**global capability available from every session** — from any session, whatever
folder it's working in, the user can ask Hearth to change itself; that edits
Hearth's own repo, commits a `Hearth-SelfMod`, and HMR-reloads. The Self-edit chip,
the **Self** tab, and **History** are always present.

**"Workspaces" are other local folders** the user opens. A workspace only sets the
**task cwd** for a session. Two file scopes per turn, tracked independently:

| Scope | What | Edits |
|---|---|---|
| **Hearth repo** (`REPO_ROOT`) | the running app's source | self-mod commit → **HMR**, lands in History (or Personality/Memory by kind). Watched after *every* turn, any session. |
| **Session workspace** (`cwd`) | the task folder (may equal `REPO_ROOT`) | normal git working-tree edits, shown in Review. No auto-commit, no HMR. |

The agent is told `REPO_ROOT` (+ self-edit instructions) in every session so it can
self-edit regardless of cwd. `captureTurn` always targets `REPO_ROOT`.

---

## Decisions (locked)

- **Sessions: persist to disk.** Append-only JSONL transcript per session +
  a JSON index (id/title/workspace/timestamps/self-flag). Matches the ecosystem
  (Claude Code `~/.claude/projects/*.jsonl`, Codex `~/.codex/sessions`, Zed
  threads). Survives restarts; powers Recents/Search/resume.
- **Settings scope:** Account (display), **Appearance**, **Agent**, **Personality +
  Memory**. **No self-evolution toggles** — self-evolution is built-in and always
  on, not switchable.
- **Onboarding:** trimmed to **connect-agent + choose-workspace**, first-run only.
  No personality step (set in Settings).
- **History / Personality / Memory are three distinct surfaces.** Self-mod commits
  are categorized via a `Hearth-Kind: code|soul|memory` trailer (derived from which
  managed files changed) and routed: **History** = code/UI/skill self-mod timeline;
  **Personality** = soul changes; **Memory** = memory changes. Never mixed.
- **History undo / redo:** **Model A** (append-only `git revert`), revert conflicts
  **auto-resolved by Hearth's agent**, no checkout-style "Restore" for now. Signed
  off — see [SELF-EVOLUTION-HISTORY.md](SELF-EVOLUTION-HISTORY.md).
- **Soul (personality) + Memory** (signed off — [SOUL-AND-MEMORY.md](SOUL-AND-MEMORY.md)):
  one managed-block writer for **both** backends, targeting each one's native global
  instructions (Claude's isolated `CLAUDE_CONFIG_DIR/CLAUDE.md`; the user's
  `~/.codex/AGENTS.md`, surgical block). Memory is **global + per-workspace**
  (per-workspace = a managed block in that workspace's project instructions); single
  source of truth = Hearth's blocks. Global soul + memory are committed (categorized;
  surface under Personality/Memory).
- **Self tab:** keep as a distinct, always-present workbench tab.
- **Folder-workspace config (default):** respect each folder's own `.claude`
  settings; only isolate `CLAUDE_CONFIG_DIR` where needed for auth. Don't write
  Hearth's permission pins into user folders.

---

## Architecture decisions

1. **Port the handoff CSS as Hearth's design system.** Lift the `:root` tokens +
   component classes from `Hearth.html` into `src/styles/`; build React components
   against those class names. Tailwind v4 stays for incidental utility. Add
   `@phosphor-icons/web` (thin + fill).
2. **Keep the architecture; restyle within it.** TanStack file routes per top-level
   screen; the handoff *shell* becomes the `__root` layout. Zustand for shared UI
   state. Preserves the self-mod route seam AND delivers the design.
3. **Agent cwd per session + self-edit reach.** Thread `cwd` from session →
   `AgentHost.prompt` → `AcpClient.newSession({cwd})`; inject `REPO_ROOT` +
   self-edit instructions into every session; `captureTurn` always targets `REPO_ROOT`.
4. **Self-mod global, `REPO_ROOT`-scoped** (see principle).
5. **The agent can see/drive the app AND the browser** via Hearth's MCP server —
   `view_app`/`read_ui`/`click`/`fill`/`eval_js` for the renderer (built), plus
   `browser_*` for the embedded browser pane (P4-3b). Backend-agnostic; the agent
   shares the user's persistent, logged-in browser rather than depending on each
   backend's native/add-on browser support.
6. **All in `src/`** → hot-reloadable, self-editable. The new UI is itself evolvable.

---

## Definition of done & verification protocol

Every phase must end green and be checkpoint-committed. A task is "done" only when:

- **Logic gates pass:** `bun run typecheck && bun run lint && bun test && bun run build` all green.
- **Boot gate:** `bun dev` boots with no renderer crash and no unhandled rejection
  (check the dev log + a `view_app` screenshot).
- **Visual gate (for UI tasks):** drive `view_app` (and `view_app?path=/route` for
  specific screens; `HEARTH_FAKE_AGENT=1` for chat states without burning tokens)
  and compare against the matching handoff screen (`design/handoff/`). Fidelity is
  judged on layout, spacing, type scale, color tokens, light AND dark. Flag any
  deliberate deviation. A human eyeballs fidelity at each phase checkpoint.
- **TDD where logic exists** (IPC, stores, diff parsing, session/workspace model,
  history): test-first, don't overfit. Pure-UI presentation is verified visually,
  not over-unit-tested.
- **Checkpoint commit per phase** (and per meaningful task); never commit red.
- **Match the existing codebase** (style, patterns, deps). No new frameworks unless
  the plan calls for it (Phosphor, node-pty, xterm, CodeMirror 6 are sanctioned here;
  the Browser uses Electron's built-in `WebContentsView`, no dep).

---

## Phases

`∥` = task can run as a parallel subagent (file-disjoint).

### P0 — Design system + shell (foundation; serial)
- [x] **P0-1.** Port tokens + component CSS from `Hearth.html` into `src/styles/`;
      wire light/dark + the 4 accents (Ember/Amber/Sage/Clay). Add Phosphor.
      *Accept:* tokens resolve; theme + accent switch live.
- [x] **P0-2.** Brand primitives: `FlameMark`, `AsciiEmber`, `ThinkingEmber`,
      `Icon`, custom rail/panel SVG icons. *Accept:* render in both themes.
- [x] **P0-3.** Shell `__root`: floating-cards frame, **rail** (brand, nav,
      workspaces tree, recent, footer, collapse), **topbar** (crumbs, ⋯ menu, panel
      toggles), **resizers**. Zustand store: theme/accent/layout/rail+panel sizes.
      *Accept:* shell renders pixel-close (light+dark) vs handoff; rail collapses;
      resizers work.
- [x] **P0-4.** Layout modes: companion / split / focus (overlay + scrim).
      *Accept:* all three match handoff behavior.
- [x] **P0-5.** Logic gates + boot + visual gate green; checkpoint commit.

### P1 — Chat, wired (core loop, re-skinned; serial)
- [x] **P1-1.** Chat surface: messages, role headers, tool-strips, `wb-ref` /
      `plan-ref` chips. Map the ACP stream (`message/thought/tool-call/diff`) to it.
- [x] **P1-2.** **Agent-trace timeline** (steps, status nodes, spine, inline
      mini-diff, progressive reveal, result row → open Review). Drive from the stream.
- [x] **P1-3.** Composer: ctx chips (branch, self-edit), mode seg (plan/auto/ask →
      permission/plan mode), send/stop → `agent.prompt`/`cancel`; thinking ember + run line.
- [x] **P1-4.** Approve card ← `permission.onRequest/respond`; backend switch in the
      composer/popover ← `agent.getBackend/setBackend`.
- [x] **P1-5.** Replace the v1 `ChatApp`. Gates + visual + a live turn (non-nested)
      render as the trace timeline; checkpoint commit.

### P2 — Workbench: shell + Review + Plan + Self + Git  ∥
The workbench is one `WorkPanel` rendered in BOTH a right panel and a bottom panel,
each with its own active tab. Panel content is scoped to the **active session +
workspace cwd**. Chat `wb-ref`/`plan-ref` chips open the right panel to a tab
(`openTab`). Full tab set: Review · Self · Files · Terminal · Browser · Plan (Files/
Terminal/Browser land in P4).
- [x] **P2-0.** Workbench shell: right + bottom panels (shared `WorkPanel`), tab bar
      (badges), add-tab menu, env/git button, close. Wire chat chips → `openTab`.
- [x] **P2-1.** ∥ **Review/diff:** `getDiff(cwd, rev?)` IPC (dugite) → structured
      hunks; `DiffView` + Review subhead (branch, +/-, "Open in Self"). TDD the diff parse.
- [x] **P2-2.** ∥ **Plan:** capture ACP `plan` session updates (currently dropped in
      `acp-translate`) → per-session plan store → Plan tab + chat plan-ref.
- [x] **P2-3.** ∥ **Self tab:** wired to self-mod, always available. **Apply model:
      AUTO-APPLY** (locked) — permission-gate *before* the write → agent writes →
      `captureTurn` commits + HMR. So the Self tab shows *what just changed* (the
      latest self-edit set + result) with an **Undo** (→ History), not a manual apply
      gate. *Accept:* reflects the latest self-edit; Undo reverts it.
- [x] **P2-4.** ∥ **Environment & git** (the panel's git button + Review's **Draft
      PR**): working-tree status, stage/commit, branch switch/create, create PR
      (via `gh` if present, else surface the command). Operates on the active
      workspace cwd; built on dugite. TDD the git ops. *(Net-new subsystem the panel
      bars imply — was previously only a toast in the mock.)*
- [x] **P2-5.** Gates + visual (both panels, all three layouts); checkpoint commit.

### P3 — Workspaces + Sessions (keystone; serial spine, ∥ within)
- [x] **P3-1.** Workspace registry (`electron/main/workspaces/`): built-in Hearth
      workspace + user-opened folders; `dialog.showOpenDialog`; per-workspace git
      branch + dirty status (dugite). IPC `workspaces.list/open/remove/status`. TDD.
- [x] **P3-2.** Session store (`electron/main/sessions/`): JSONL transcript +
      JSON index; IPC `sessions.list/create/get/rename/duplicate/archive/delete/export`.
      TDD the store.
- [x] **P3-3.** Per-session cwd threaded → agent; inject `REPO_ROOT` + self-edit
      context into every session; `captureTurn` always `REPO_ROOT`.
- [x] **P3-4.** Rail workspaces tree + Recents (live data); Home screen; Workspace
      detail screen.
- [x] **P3-5.** ∥ Search screen over the session store (after P3-2).
- [x] **P3-6.** *Accept (gate):* open a 2nd folder → start a session there → agent
      edits the folder (correct cwd, **no HMR**); from that same session ask Hearth
      to change itself → **self-mod commit + HMR fires**; restart → sessions +
      transcripts restored. Checkpoint commit.

### P4 — Files+Editor / Terminal / Browser  ∥
- [x] **P4-1.** ∥ **Files + editor:** `fs` IPC (dir tree + read **and write**) rooted
      at the active workspace cwd. Files tab = tree → open a file in an in-app
      **CodeMirror 6** editor: syntax highlighting for code, **markdown editing with a
      preview toggle**, dirty/save state, save to disk. Add CodeMirror deps. *Accept:*
      open/edit/save a code file and a markdown file. *(Note: editing a Hearth source
      file HMRs live but is NOT auto-committed — History is agent self-mods, not the
      user's manual editor edits.)*
- [x] **P4-2.** ∥ **Terminal:** `node-pty` PTY per panel (cwd = workspace) streamed
      to `xterm.js`. Add deps. *Accept:* a real shell runs in the panel.
- [x] **P4-3.** ∥ **Browser (real, persistent):** an embedded Chromium pane
      (`WebContentsView`) the user can navigate **anywhere** and **log into** — backed
      by a persistent session partition (`persist:hearth-browser`) so cookies/logins
      survive restarts. Full chrome: editable URL bar, back/forward/reload, loading
      state, open-external. Main positions the view over the panel region and **syncs
      bounds** on resize/layout/route/panel-toggle (hide it when the panel/route is
      hidden — the view floats above the renderer). Convenience: auto-fill a detected
      dev-server URL (via `extractDevUrl`) and default Hearth to its renderer URL — but
      it's a general browser, not just a preview. Per-workspace last-URL remembered.
      *Accept:* browse to a site, log in, restart, still logged in.
- [x] **P4-3b.** ∥ **Agent browser control** (same pattern as `view_app`/control, but
      targeting the browser view's webContents): extend the Hearth MCP server with
      `browser_navigate / browser_read (snapshot+text) / browser_screenshot /
      browser_click / browser_fill / browser_eval / browser_back|forward|reload`.
      The agent drives the **same persistent browser the user logs into** — so it can
      act in the user's authenticated sessions. Permission-gated like the other control
      tools; backend-agnostic (works on Claude AND Codex without relying on either's
      native/add-on browser support). *Accept:* the agent navigates + reads a page via
      the tools; a user login is visible to the agent's reads.
- [x] **P4-4.** Gates + visual; checkpoint commit.

### P5 — Settings + Personality/Memory + Agents  ∥
- [x] **P5-1.** ∥ Settings screen: Account (display), Appearance (✅ wire),
      Agent (default backend/model, command-approval → `HEARTH_PERMISSION_MODE`).
      **No self-evolution toggles.**
- [x] **P5-2.** ∥ Personality + Memory per [SOUL-AND-MEMORY.md](SOUL-AND-MEMORY.md)
      (signed off): one managed-block writer → each backend's native global
      instructions (Claude's isolated `CLAUDE_CONFIG_DIR/CLAUDE.md`; surgical block in
      `~/.codex/AGENTS.md`). Move Hearth's operating instructions there too (so they
      apply in folder workspaces — fixes today's repo-cwd-only gap). Compile
      Personality → Soul block; Memory = global block + per-workspace block (in the
      workspace's project instructions); read/updated via chat. Commit + categorize
      (`Hearth-Kind`) so soul/memory edits surface under Personality/Memory, not History.
- [x] **P5-3.** Per-model select for the two backends (Claude/Codex), wired to ACP `availableModels`/`set_model`. Arbitrary ACP connectors are explicitly OUT of scope (decision: two backends only).
      (generalize beyond claude/codex). 
- [x] **P5-4.** Gates + visual; checkpoint commit.

### P6 — History/Personality/Memory + ⌘K + onboarding + polish
- [x] **P6-1. History** (the code self-mod timeline) — build
      per [SELF-EVOLUTION-HISTORY.md](SELF-EVOLUTION-HISTORY.md) (signed off: **Model A**
      append-only revert; revert **conflicts auto-handed to Hearth's agent**; no
      checkout-style "Restore" for now). Timeline (applied/undone, current-build
      boundary derived from net-effect), undo/redo, conflict→agent-resolve, clean-tree
      guard, HMR tier via `diffPaths`. Filter to `Hearth-Kind: code`. TDD the model.
- [x] **P6-1b. Personality + Memory surfaces** — the soul-change and memory-change
      histories (commits filtered by `Hearth-Kind: soul` / `memory`), distinct from
      History. (Settings hosts the editors; these are the change views.)
- [x] **P6-2.** ⌘K command palette (nav / skills / workspaces / theme actions).
- [x] **P6-3.** Onboarding (trimmed: connect-agent + choose-workspace), first-run
      only; first-run state persisted.
- [x] **P6-4.** Toasts, context menus, popovers; final fidelity pass; checkpoint commit.

---

## Parallelization

P0 → P1 are the serial spine (design system + shell, then the core chat). After
that: P2 (workbench tabs), P5 (settings/agents), and P6-2/3/4 are largely
file-disjoint → parallel subagents, partitioned by route/component, sharing only
the design-system CSS (read-only) and the IPC `channels.ts` (coordinate additions
through one owner, as in v1). **P3 (workspaces+sessions) is the keystone** —
Files/Terminal/Browser/Review all key off "active workspace cwd," so build P3
before fully generalizing P4 (P4 can be built against the Hearth workspace first).
Run `/goal` **phase by phase** (checkpoint + eyeball fidelity between phases)
rather than one sweep — this build is visual and has product judgment in it.

---

## Open questions

None blocking. All decisions are signed off — sessions (persist), settings,
onboarding (trim), History model (Model A, agent-resolves conflicts), Soul + Memory
(native managed-block, global + per-workspace) and the History/Personality/Memory
split, workbench (auto-apply self-edits, git-ops subsystem, real persistent browser
the **agent** can also drive, in-app CodeMirror editor). **P0 is ready to start.**
