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
| **Hearth repo** (`REPO_ROOT`) | the running app's source | self-mod commit → **HMR**, lands in History. Watched after *every* turn, any session. |
| **Session workspace** (`cwd`) | the task folder (may equal `REPO_ROOT`) | normal git working-tree edits, shown in Review. No auto-commit, no HMR. |

The agent is told `REPO_ROOT` (+ self-edit instructions) in every session so it can
self-edit regardless of cwd. `captureTurn` always targets `REPO_ROOT`.

---

## Decisions (locked)

- **Sessions: persist to disk.** Append-only JSONL transcript per session +
  a JSON index (id/title/workspace/timestamps/self-flag). Matches the ecosystem
  (Claude Code `~/.claude/projects/*.jsonl`, Codex `~/.codex/sessions`, Zed
  threads). Survives restarts; powers Recents/Search/resume.
- **Settings scope:** Account (display), **Appearance**, **Agent**,
  **Personality→soul.md + Memory**. **No self-evolution toggles** — self-evolution
  is built-in and always on, not switchable.
- **Onboarding:** trimmed to **connect-agent + choose-workspace**, first-run only.
  No personality step (set in Settings).
- **History / undo / redo:** **Model A** (append-only `git revert`), revert
  conflicts **auto-resolved by Hearth's agent**, no checkout-style "Restore" for now.
  Signed off — see [SELF-EVOLUTION-HISTORY.md](SELF-EVOLUTION-HISTORY.md).
- **soul.md / memory.md:** `soul.md` is generated from the Personality settings
  (response length · directness · formatting density) and injected into every
  session's agent context; the user tunes the toggles, not the file. `memory.md` is
  plain markdown the agent reads at session start and appends on "remember/forget".
  Both live under Hearth's config (`.hearth/`, gitignored runtime state). Refine the
  exact schema at P5-2; this default unblocks it.
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
5. **All in `src/`** → hot-reloadable, self-editable. The new UI is itself evolvable.

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
  the plan calls for it (Phosphor, node-pty, xterm are sanctioned here).

---

## Phases

`∥` = task can run as a parallel subagent (file-disjoint).

### P0 — Design system + shell (foundation; serial)
- [ ] **P0-1.** Port tokens + component CSS from `Hearth.html` into `src/styles/`;
      wire light/dark + the 4 accents (Ember/Amber/Sage/Clay). Add Phosphor.
      *Accept:* tokens resolve; theme + accent switch live.
- [ ] **P0-2.** Brand primitives: `FlameMark`, `AsciiEmber`, `ThinkingEmber`,
      `Icon`, custom rail/panel SVG icons. *Accept:* render in both themes.
- [ ] **P0-3.** Shell `__root`: floating-cards frame, **rail** (brand, nav,
      workspaces tree, recent, footer, collapse), **topbar** (crumbs, ⋯ menu, panel
      toggles), **resizers**. Zustand store: theme/accent/layout/rail+panel sizes.
      *Accept:* shell renders pixel-close (light+dark) vs handoff; rail collapses;
      resizers work.
- [ ] **P0-4.** Layout modes: companion / split / focus (overlay + scrim).
      *Accept:* all three match handoff behavior.
- [ ] **P0-5.** Logic gates + boot + visual gate green; checkpoint commit.

### P1 — Chat, wired (core loop, re-skinned; serial)
- [ ] **P1-1.** Chat surface: messages, role headers, tool-strips, `wb-ref` /
      `plan-ref` chips. Map the ACP stream (`message/thought/tool-call/diff`) to it.
- [ ] **P1-2.** **Agent-trace timeline** (steps, status nodes, spine, inline
      mini-diff, progressive reveal, result row → open Review). Drive from the stream.
- [ ] **P1-3.** Composer: ctx chips (branch, self-edit), mode seg (plan/auto/ask →
      permission/plan mode), send/stop → `agent.prompt`/`cancel`; thinking ember + run line.
- [ ] **P1-4.** Approve card ← `permission.onRequest/respond`; backend switch in the
      composer/popover ← `agent.getBackend/setBackend`.
- [ ] **P1-5.** Replace the v1 `ChatApp`. Gates + visual + a live turn (non-nested)
      render as the trace timeline; checkpoint commit.

### P2 — Workbench: Review + Plan + Self  ∥
- [ ] **P2-0.** Workbench shell: right + bottom panels (shared `WorkPanel`), tab bar,
      add-tab menu, env/close, resizers.
- [ ] **P2-1.** ∥ **Review/diff:** `getDiff(cwd, rev?)` IPC (dugite) → structured
      hunks; `DiffView` + Review subhead (branch, +/- , Draft PR). TDD the diff parse.
- [ ] **P2-2.** ∥ **Plan:** capture ACP `plan` session updates (currently dropped in
      `acp-translate`) → per-session plan store → Plan tab + chat plan-ref.
- [ ] **P2-3.** ∥ **Self tab:** self-edit file list + Apply, wired to self-mod;
      always available. *Accept:* shows the current self-edit set; Apply triggers it.
- [ ] **P2-4.** Gates + visual; checkpoint commit.

### P3 — Workspaces + Sessions (keystone; serial spine, ∥ within)
- [ ] **P3-1.** Workspace registry (`electron/main/workspaces/`): built-in Hearth
      workspace + user-opened folders; `dialog.showOpenDialog`; per-workspace git
      branch + dirty status (dugite). IPC `workspaces.list/open/remove/status`. TDD.
- [ ] **P3-2.** Session store (`electron/main/sessions/`): JSONL transcript +
      JSON index; IPC `sessions.list/create/get/rename/duplicate/archive/delete/export`.
      TDD the store.
- [ ] **P3-3.** Per-session cwd threaded → agent; inject `REPO_ROOT` + self-edit
      context into every session; `captureTurn` always `REPO_ROOT`.
- [ ] **P3-4.** Rail workspaces tree + Recents (live data); Home screen; Workspace
      detail screen.
- [ ] **P3-5.** ∥ Search screen over the session store (after P3-2).
- [ ] **P3-6.** *Accept (gate):* open a 2nd folder → start a session there → agent
      edits the folder (correct cwd, **no HMR**); from that same session ask Hearth
      to change itself → **self-mod commit + HMR fires**; restart → sessions +
      transcripts restored. Checkpoint commit.

### P4 — Files / Terminal / Browser  ∥
- [ ] **P4-1.** ∥ **Files:** sandboxed `fs` IPC (dir tree + read) rooted at active
      workspace cwd; Files tab.
- [ ] **P4-2.** ∥ **Terminal:** `node-pty` PTY per panel (cwd = workspace) streamed
      to `xterm.js`. Add deps. *Accept:* a real shell runs in the panel.
- [ ] **P4-3.** ∥ **Browser:** `WebContentsView` + back/reload/url/open-external;
      points at a workspace dev server or URL.
- [ ] **P4-4.** Gates + visual; checkpoint commit.

### P5 — Settings + Personality/Memory + Agents  ∥
- [ ] **P5-1.** ∥ Settings screen: Account (display), Appearance (✅ wire),
      Agent (default backend/model, command-approval → `HEARTH_PERMISSION_MODE`).
      **No self-evolution toggles.**
- [ ] **P5-2.** ∥ Personality → compile choices to `soul.md`, injected into agent
      context; Memory → local `memory.md` (read/write via chat). Define formats; TDD compile.
- [ ] **P5-3.** ∥ Agents screen: per-model select; connect an arbitrary ACP server
      (generalize beyond claude/codex). 
- [ ] **P5-4.** Gates + visual; checkpoint commit.

### P6 — History (design-gated) + ⌘K + onboarding + polish
- [ ] **P6-1. History** — build per [SELF-EVOLUTION-HISTORY.md](SELF-EVOLUTION-HISTORY.md)
      (signed off: **Model A** append-only revert; revert **conflicts auto-handed to
      Hearth's agent** to resolve; no checkout-style "Restore" for now). Timeline
      (applied/undone, current-build boundary derived from net-effect), undo/redo,
      conflict→agent-resolve, clean-tree guard, HMR tier via `diffPaths`. TDD the model.
- [ ] **P6-2.** ⌘K command palette (nav / skills / workspaces / theme actions).
- [ ] **P6-3.** Onboarding (trimmed: connect-agent + choose-workspace), first-run
      only; first-run state persisted.
- [ ] **P6-4.** Toasts, context menus, popovers; final fidelity pass; checkpoint commit.

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

None blocking. All decisions are locked above; the `soul.md`/`memory.md` schema has
a working default and is refined at P5-2. The plan is ready to execute.
