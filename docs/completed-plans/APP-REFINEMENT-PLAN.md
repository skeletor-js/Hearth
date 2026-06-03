# Hearth App Refinement Plan

**Status: COMPLETE (2026-06-02).** All twelve workstreams (W1–W12) shipped;
`bun run typecheck`, `bun run lint`, and `bun test` (319 pass) are green, and the
rail / Home / Search / History surfaces were verified live. The collapse-to-icon
rail finding was resolved first (orphaned CSS deleted). See the resolved-decisions
note and implementation log at the bottom.

This plan refines surfaces that are already built. The theme is **finish what's
80% there, remove confusion between overlapping surfaces, and turn already-styled
dead code into real features.** No new frameworks, no architectural change — these
are renderer edits that hot-reload, plus a few `electron/main/sessions` touches.

Reuse the design system (tokens + existing classes; see AGENTS.md). Run
`bun run typecheck` after each workstream. Verify in the live app with `view_app`
after UI changes.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Verified facts the plan rests on

- **Sessions are created eagerly.** [`startSession`](../../src/app/sessions.ts:10)
  calls `sessions.create` the instant New Session or a workspace is clicked,
  persisting a record before any prompt.
- **Auto-titling only fires on first user message.**
  [`store.ts:141`](../../electron/main/sessions/store.ts) sets the title from the
  first user line *on append*. A created-but-unused session keeps the default
  `'New session'` ([store.ts:92](../../electron/main/sessions/store.ts)) forever.
  → Net effect: unused sessions accumulate as identical "New session" rows across
  the rail, Home "Continue", Search, and History.
- **Search is metadata-only.** [`search.tsx:23`](../../src/routes/search.tsx)
  filters `title + cwd`. Snippet styles `.sr-snip` / `.sr-snip mark`
  ([hearth.css](../../src/styles/hearth.css)) exist but are never rendered.
- **Transcripts are persisted as JSONL** and replayable
  ([ChatView persist](../../src/app/chat/ChatView.tsx:80)) — the data for content
  search already exists on disk.
- **Draft PR sends an empty body.**
  [`ReviewTab.tsx:71`](../../src/app/workbench/ReviewTab.tsx) — auto title, `''`
  body, result rendered as a raw mono string.
- **Two permission concepts coexist:** app-level `approval`
  (auto/commands/always, [store.ts:39](../../src/shell/store.ts)) and the agent's
  native session `mode` ([Composer popover](../../src/app/chat/Composer.tsx:91)).
- **Confirmed dead CSS** (no component references): `.evo-boundary`, the
  `.tool-strip`/`.ts-*` family (superseded by `.trace`), and `.sr-snip`
  (reclaimed by W2).

---

## Sequencing

```
Phase 1  Session lifecycle & search   W1 → W2
Phase 2  Quick correctness fixes      W3  W4  W5   (independent, parallel-safe)
Phase 3  Workbench depth              W6  W7  W8
Phase 4  Onboarding & permissions     W9  W10
Phase 5  Design hygiene               W11  W12
```

Phase 1 first — it fixes the most visible daily annoyance and unblocks search.
Phase 2 items are tiny and independent (good parallel-subagent candidates, disjoint
files). Phases 3–5 layer on top.

---

## Phase 1 — Session lifecycle & search

### W1 — Stop accumulating empty "New session" rows `[x]`
**Problem:** every New Session / workspace click persists an untitled session;
unused ones never get a title and clutter every session list.
**Approach (pick one, A preferred):**
- **A — Lazy create.** Defer `sessions.create` until the first prompt. Make the
  active session in-memory (a "draft") until `send` runs, then create + persist and
  title from the first line in one step. Touch
  [`sessions.ts`](../../src/app/sessions.ts),
  [`ChatView.send`](../../src/app/chat/ChatView.tsx:332),
  [`session-store.ts`](../../src/app/session-store.ts).
- **B — Prune empties.** Keep eager create but filter zero-entry sessions out of
  `sessions.list` results (or add a `sessions.pruneEmpty` on session switch). Touch
  [`electron/main/sessions/store.ts`](../../electron/main/sessions/store.ts).
**Decision needed:** A is cleaner but changes the active-session contract (a session
may now be null/draft on the chat route). Confirm before building.
**Acceptance:** open New Session three times without typing → Recent shows no new
rows. Type in one → it appears, titled from the first line.

### W2 — Search conversation content, with snippets `[x]`
**Problem:** [`search.tsx`](../../src/routes/search.tsx) can't find anything said
in a conversation; the snippet UI is styled but dead.
**Change:**
- Add a main-side full-text search over persisted transcripts (grep the JSONL
  entries' text), exposed via a new `sessions.search(query)` IPC. Cap results, return
  `{ meta, snippet, matchRanges }`.
- Render snippets in `.sresult` using the existing `.sr-snip` / `mark` classes
  (reclaims that CSS). Keep the title/workspace match as a fast path.
- De-dupe intent with CommandPalette (palette = navigation; Search = content).
**Files:** [`src/routes/search.tsx`](../../src/routes/search.tsx),
`electron/main/sessions/*`, preload bridge.
**Acceptance:** searching a phrase only spoken mid-conversation surfaces that
session with a highlighted snippet.

---

## Phase 2 — Quick correctness fixes (independent, disjoint files)

### W3 — Escape in the slash menu shouldn't wipe the message `[x]`
[`Composer.tsx:463`](../../src/app/chat/Composer.tsx) runs `setInput('')` on Escape
while the slash menu is open. Change Escape to only dismiss the menu (track an
explicit `slashDismissed` flag or clear just the matches), preserving typed text.
**Acceptance:** type a message, trigger `/`, press Escape → menu closes, text stays.

### W4 — Quiet the Plan tab priority noise `[x]`
[`PlanTab.tsx:28`](../../src/app/workbench/PlanTab.tsx) prints "{priority} priority"
on every row; ACP plans are usually uniformly "medium". Show step index / progress
instead, and surface priority only when `high`. **Acceptance:** a typical plan reads
as a clean numbered checklist with no repeated "medium priority".

### W5 — Keyboard focus rings (a11y) `[x]`
No global `:focus-visible` styling on interactive elements
([hearth.css](../../src/styles/hearth.css)); a ⌘K/⌘N-driven tool is hover-only.
Add a token-based `:focus-visible` outline (accent ring, e.g.
`box-shadow:0 0 0 2px var(--accent-soft)` + `outline`) to `.btn`, `.btn-icon`,
`.rail-item`, `.foot-settings`, `.wb-tab`, `.cmdk-row`, `.chip`, `.field`,
`.swatch`. Respect `data-reduce-motion`. **Acceptance:** Tab through the rail,
composer, and command palette → focused element is always visibly ringed.

---

## Phase 3 — Workbench depth

### W6 — Make "Draft PR" real `[x]`
[`ReviewTab.tsx:71`](../../src/app/workbench/ReviewTab.tsx) sends an empty body and
dumps a raw string. Change:
- Have the agent draft a PR title + body from the diff (route through the existing
  agent; the session is right there), with a short editable confirm step.
- Render the result as a proper status with a **clickable** PR link when created,
  not `Run: …` text.
**Files:** [`src/app/workbench/ReviewTab.tsx`](../../src/app/workbench/ReviewTab.tsx),
`electron/main/self-mod/git*` (createPr return shape).
**Acceptance:** Draft PR produces a populated title+body and a clickable link.

### W7 — FilesTab: file operations + git-status markers `[x]`
[`FilesTab.tsx`](../../src/app/workbench/FilesTab.tsx) is read/edit/save only.
- Surface git status in the tree (reuse `git.diff`, which Review already loads):
  tag modified/added/deleted via the existing `.ftree-row .tag.m`/`.tag.a` styles.
- Add new file / rename / delete (guarded by the same write path the agent uses).
- Add a filename filter input in the subhead.
**Decision needed:** scope — markers + filter are low-risk; create/rename/delete
touch the fs write guard. Confirm whether destructive ops are in scope.
**Acceptance:** edited files show a marker in the tree; filtering narrows it.

### W8 — Clarify Self vs Review vs History `[x]`
Three surfaces show "what changed" and Review links into Self, which confuses the
division. Tighten roles without merging:
- **Self** = "what Hearth just did to itself + Undo" (last self-edit).
- **Review** = live working-tree diff.
- **History** = full versioned timeline.
Make each empty state + subhead say which is which; reconsider the Review→Self
button ([ReviewTab.tsx:91](../../src/app/workbench/ReviewTab.tsx)). Copy + light
structure only — no behavior change. **Acceptance:** a new user can tell from the
panels alone which surface to use for which question.

---

## Phase 4 — Onboarding & permissions

### W9 — Verify sign-in during onboarding `[x]`
[`Onboarding.tsx`](../../src/shell/Onboarding.tsx) step 0 picks a backend but never
checks auth; a first-run user can finish and hit `agent error` on first prompt.
Use the existing `auth.status` IPC to show live sign-in state in step 0, offer the
`login` command inline (mirror [AuthSection](../../src/app/settings/sections/AuthSection.tsx)),
and warn (don't hard-block) when the chosen backend isn't authenticated.
**Acceptance:** onboarding shows "Signed in / Not signed in" for the chosen backend
and surfaces the login command if not.

### W10 — Reconcile the two permission controls `[x]`
App-level `approval` (Settings) and the agent's native session `mode` (composer
popover) are both "permissions," in two places.
**Decision needed:** (a) keep both but cross-reference in copy so it's clear app
`approval` gates what reaches the UI while `mode` is the agent's own setting, or
(b) collapse into one control. Recommend (a) first (lower risk).
**Acceptance:** the relationship between the two is legible from the UI; no silent
conflict between them.

---

## Phase 5 — Design hygiene

### W11 — Promote drifting inline styles to classes `[x]`
Chunky `style={{…}}` blocks fighting the design system in
[`SelfTab.tsx:46-57`](../../src/app/workbench/SelfTab.tsx),
[`History.tsx:139`](../../src/app/history/History.tsx),
[`search.tsx:43`](../../src/routes/search.tsx), and settings rows. Extract the
repeated patterns (self-edit file row; icon+title screen header) into classes in
[hearth.css](../../src/styles/hearth.css). Visual output unchanged — this is
consolidation. **Acceptance:** those one-off style blocks are gone; rendering is
pixel-stable (compare `view_app` before/after).

### W12 — Delete remaining dead CSS `[x]`
Remove confirmed-orphan blocks from [hearth.css](../../src/styles/hearth.css):
`.evo-boundary` and the `.tool-strip`/`.ts-*` family (superseded by `.trace`).
**Do this after W2** so `.sr-snip` is reclaimed rather than deleted. Re-grep each
class against `src/` before cutting. **Acceptance:** no component references the
removed classes; typecheck + app render unaffected.

---

## Out of scope (deliberately)

- Collapse-to-icon rail — removed, not coming back (CSS already deleted).
- Any new backend/protocol surface — covered by the completed ACP plan.
- Micro-app / packaging changes.

## Resolved decisions (as built)
- **W1 → B (prune/hide untouched).** Localized to `store.ts`, no active-session
  contract change. "Untouched" ⟺ `updatedAt === createdAt`, made collision-proof by
  bumping `updatedAt` to `max(now, createdAt+1)` on every `append`/`rename`. `list()`
  hides untouched; `create()` sweeps them off disk. Pre-existing touched-but-untitled
  sessions can still read "New session" (legacy data, not new clutter).
- **W7 → markers + filter + new-file; no destructive ops.** Git-status markers reuse
  the `.tag.m`/`.tag.a` styles; the filter narrows files by name (dirs stay, since the
  tree is lazy); new-file writes through the same `files.write` guard. Rename/delete
  were left out to avoid touching the write-guard surface.
- **W10 → (a) cross-reference.** Settings "Command approval" and the composer's
  "Permission mode" now each name the other in copy; neither was merged or removed.

## Implementation log
- **W1/W2** `electron/main/sessions/store.ts` (+ `store.test.ts`): `untouched`/`bumped`
  helpers, `list()` hides untouched, `create()` sweeps, and a `search()` over
  transcript content with snippets. New IPC `sessions:search` (channels + ipc +
  preload). `src/routes/search.tsx` rewritten to call it and render highlighted
  `.sr-snip` snippets. Tests cover hide/sweep and content-match+snippet.
- **W3** `Composer.tsx`: `slashDismissed` flag — Escape closes the slash menu and
  preserves typed text; re-opens as the token changes.
- **W4** `PlanTab.tsx`: "Step n of N" with priority shown only when `high`.
- **W5** `hearth.css`: `:focus-visible` accent outline on focusable controls.
- **W6** `ReviewTab.tsx` + css: editable PR draft (title + diff-derived body) and a
  clickable result link (`createPr` already returns the URL); body is local, not a
  fragile parse of the agent stream.
- **W7** `FilesTab.tsx` + css: status markers, filename filter, inline new-file.
- **W8** `ReviewTab.tsx` / `SelfTab.tsx`: role copy; the Review→Self button is now
  conditional on a self-edit existing (also fixes selecting a non-existent tab).
- **W9** `Onboarding.tsx`: live sign-in status + inline login command in step 0
  (warns, never blocks), reusing the settings controls.
- **W10** `settings.tsx` + `Composer.tsx` + css (`.pop-note`): cross-referencing copy.
- **W11** `hearth.css` (`.screen-head`, `.self-file`, `.search-controls`) replacing
  inline-style blocks in History/SelfTab/search; rendering pixel-stable.
- **W12** removed the dead `.tool-strip`/`.ts-*` family and `.evo-boundary`.
