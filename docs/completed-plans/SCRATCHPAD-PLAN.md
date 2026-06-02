# Plan — Scratchpad

A persistent place to jot notes that the agent can read on demand, send on command,
or have auto-attached to every turn. Lives as a tab in the right/bottom work panels
([WorkPanel.tsx](../../src/app/workbench/WorkPanel.tsx)), backed by a real markdown file
on disk.

The whole thing is one feature, file-disjoint enough to run as a single `/goal` with
three phases (S1 storage → S2 tab → S3 injection) plus a gate phase.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Grounding (current state — verified)

- The right & bottom bars are two `WorkPanel` instances; each owns its active tab
  (`rightTab`/`bottomTab` in [shell/store.ts](../../src/shell/store.ts)). Tabs are declared
  in `WB_TABS` + `ADD_ITEMS`, dispatched in `TabBody`. Adding a tab is local to
  [WorkPanel.tsx](../../src/app/workbench/WorkPanel.tsx) — it appears in **both** bars for free.
- A file IPC already exists and is path-sandboxed to a workspace cwd:
  `window.hearth.files.read(cwd, rel)` / `files.write(cwd, rel, content)`
  ([preload/index.ts:122](../../electron/preload/index.ts), backed by
  [fs/files.ts](../../electron/main/fs/files.ts)). `safeJoin` rejects `..` escapes; reads
  over 2 MB or binary come back `readonly`.
- `fs.writeFile` does **not** `mkdir -p`. `.hearth/` exists in the Hearth repo but **not**
  in user-opened workspaces, so a write to `.hearth/scratchpad.md` there would `ENOENT`.
- `.hearth/` is gitignored ([.gitignore:17](../../.gitignore)). A pad under it is invisible to
  git status, the Review tab, and Hearth's self-mod auto-commits.
- Manual editor writes via `files.write` land on disk and HMR, but are **not** committed
  (only the agent's edits become `Hearth-SelfMod` commits — see [fs/files.ts](../../electron/main/fs/files.ts) header).
- The send path is `ChatView.send(text)` → `window.hearth.agent.prompt(sessionId, cwd, text)`
  ([ChatView.tsx:248](../../src/app/chat/ChatView.tsx)). It `pushUser(text)`, persists
  `{kind:'user', text}`, then prompts. There's an existing cross-component seam
  (`pendingPrompt` in [session-store.ts:73](../../src/app/session-store.ts)) but it only fires
  on session load — not usable for "send now".
- The Files tab already uses the editor stack we want to reuse: `@uiw/react-codemirror`
  with `@codemirror/lang-markdown`, plus `marked` + `dompurify` for preview
  ([FilesTab.tsx](../../src/app/workbench/FilesTab.tsx)). No new deps.
- Icons are Phosphor by class (`ph-{name}`); `note-pencil` is available.

---

## Decisions (locked)

- **Backing store = one markdown file per workspace** at `.hearth/scratchpad.md`, resolved
  against the active session's `cwd`. **Scope is per-workspace**: every session that shares
  a cwd shares the pad. (Recommended over per-session — a single file keeps the agent's
  read/grep trivial and matches "always there"; per-session would fragment the file and
  break grep-on-disk. Over global — the file must live in the repo the agent is working in.)
- **Storage uses the existing `files` IPC** — no new channel. The **only** main-process
  change is making `fs.writeFile` ensure its parent dir (`mkdir(dirname, {recursive:true})`)
  so `.hearth/` is created in any workspace. This is a safe general fix; it costs one app
  restart and is the sole gate that isn't hot-reloadable.
- **Surface = a `Scratchpad` tab** in the work panel (both bars). CodeMirror markdown editor
  (GFM) with **live rendering** ([markdown-live.ts](../../src/app/workbench/markdown-live.ts)):
  headings sized, bold/italic/code/strike styled, `•` bullets, real clickable task
  checkboxes, blockquotes — and all syntax markers (`#`, `**`, `` ` ``, `- `, `[ ]`, `>`)
  concealed so it reads as rendered, not source. No separate Edit/Preview mode. Icon `note-pencil`.
- **Content = freeform markdown, hard-capped.** Single editable doc. **`SCRATCHPAD_MAX = 4000`
  characters** (~1k tokens) — it's for quick notes, not a document. The editor blocks input
  past the cap and shows a char counter that warns as it approaches. The cap also bounds the
  worst-case auto-attach token cost. Tunable constant. No structured items in v1.
- **The pad is user-authored; the agent treats it as read-only.** It is for *user* notes,
  not agent scratch. S4-1's context line tells the agent it may **read** the pad and must not
  write to it. (Hearth's own UI never writes to it on the agent's behalf either.)
- **Three injection modes, all on the same file:**
  1. **Agent-readable file (passive).** The pad just exists at a known path; the agent
     reads/greps it on demand. Zero token cost until referenced.
  2. **Manual "Send to agent".** A button in the tab sends the pad (or the current text
     selection) as a normal user turn through the existing send path. **Sending does not
     clear the pad** — it's a pad, not an outbox. Disabled while a turn is in flight.
  3. **Always-on auto-attach (per-prompt prepend).** A per-workspace toggle. When on,
     `send()` prepends the pad content to the text handed to `agent.prompt`, fenced so user
     content can't break out (a fixed-token fence, e.g. ```` ```scratchpad … ``` ````, not a
     bare `<scratchpad>` tag the user could close). The visible bubble and persisted
     transcript keep **only** the typed text. Empty pad = no-op. (Rejected alternative:
     writing the pad into a CLAUDE.md/AGENTS.md managed block — reuses the soul machinery but
     creates self-mod commit churn and mixes user notes into the instruction file.)
- **Auto-attach is surfaced two ways:** the toggle in the tab header, **and** a clickable
  composer chip ("Scratchpad attached") that turns it off — so it's reachable and non-silent
  even when the panel is closed.
- **Autosave**, debounced ~500 ms, via `files.write`. Missing file on first read → treat as
  empty, create on first save. The debounce **flushes/cancels on cwd change** and binds the
  write to the captured cwd (no cross-workspace write or lost edit on session switch).
  Last-write-wins across the two bars.
- **No active session → disabled empty state** ("start a session first"); never call
  `files.read` with an undefined cwd (it throws).
- **Auto-attach toggle persists per-workspace** (keyed by cwd) in the shell store, so it
  doesn't bleed between repos.
- **Cross-component "send now" seam:** add a transient `requestPrompt(text)` signal to
  [session-store.ts](../../src/app/session-store.ts) (text + nonce); `ChatView` watches the
  nonce and routes through the same `send()`. Don't reuse `pendingPrompt` (load-only).
- **`.hearth/` is hidden from the Files tab** — add it to the `IGNORED` set in
  [fs/files.ts](../../electron/main/fs/files.ts) so the pad isn't also browsable/editable as a
  loose file (two editors, one file).
- **Verification protocol = same as the other plans:** typecheck / lint / test / build +
  boot + visual (via the `hearth` MCP); TDD the pure logic; checkpoint commit per phase;
  never commit red.

---

## Phase S1 — Storage + the one main touch  (gate: restart)

- [x] **S1-1. `fs.writeFile` ensures parent dir + hide `.hearth`.** In
      [fs/files.ts](../../electron/main/fs/files.ts): `mkdir(dirname(abs), {recursive:true})`
      before write (after `safeJoin`, so it stays sandboxed); add `'.hearth'` to the `IGNORED`
      set so the pad isn't browsable as a loose file. **TDD:** writing `a/b/c.md` under a temp
      root creates the dirs and the file; writing `../escape` still throws; `listDir` omits
      `.hearth`. *Accept:* `files.write(cwd, '.hearth/scratchpad.md', …)` succeeds in a
      workspace with no `.hearth/`.
- [x] **S1-2. Shared path + helpers (renderer).** A tiny `scratchpad.ts` lib:
      `SCRATCHPAD_REL = '.hearth/scratchpad.md'`; `SCRATCHPAD_MAX = 4000`;
      `readScratchpad(cwd)` (ENOENT/readonly → `''`); `writeScratchpad(cwd, text)` (clamps to
      `SCRATCHPAD_MAX`); `wrapForPrompt(typed, pad)` = pad blank ? `typed` : pad fenced in a
      ```` ```scratchpad ```` block followed by a blank line then `typed`. **TDD**
      `wrapForPrompt`: blank pad passthrough; non-blank fences + preserves typed text; a pad
      containing the fence/backticks doesn't let user content escape the block.
- [x] **S1-3. Gate.** Verified live: booted the worktree app, typed in the pad, and the file
      landed at `<workspace>/.hearth/scratchpad.md` with exactly the typed bytes — `mkdir`
      auto-created the dir. Unit tests ([fs/files.test.ts](../../electron/main/fs/files.test.ts))
      + green build back it.

## Phase S2 — Scratchpad tab (renderer, hot-reload)  ∥

- [x] **S2-1. Register the tab.** Add `{ id:'scratchpad', icon:'note-pencil', label:'Scratchpad' }`
      to `WB_TABS` and `ADD_ITEMS`, and a `case 'scratchpad'` in `TabBody`
      ([WorkPanel.tsx](../../src/app/workbench/WorkPanel.tsx)). Available in both bars.
- [x] **S2-2. `ScratchpadTab.tsx`.** CodeMirror (GFM) markdown editor with **live rendering**
      ([markdown-live.ts](../../src/app/workbench/markdown-live.ts)) — headings, `•` bullets,
      clickable task checkboxes, bold/italic/code/strike, blockquotes; markers concealed. No
      separate preview mode.
      Hold an `EditorView` ref (for selection-send in S3). Load `readScratchpad(active.cwd)`
      on mount / cwd change; debounced autosave (~500 ms) that **flushes/cancels on cwd
      change** and writes against the captured cwd; subtle "Saved" indicator; reload on tab
      focus (loose cross-bar sync). Enforce `SCRATCHPAD_MAX` (block input past the cap) with a
      char counter that warns near the limit. **No active session → disabled empty state**
      ("start a session first"); otherwise placeholder copy + path hint.
- [ ] **S2-3. Optional non-empty badge.** *Skipped* — `wb-badge` renders a count, not a dot;
      a dot indicator would need new CSS for marginal value. Left for later if wanted.
- [x] **S2-4. Visual check.** Verified live in both themes' default and both bars: the 7-tab
      strip (Review · Self · Scratchpad · Files · Terminal · Browser · Plan) fits cleanly in
      the right panel **and** the narrow bottom bar. Editor, "Saved" indicator, char counter,
      and empty state all render correctly.

## Phase S3 — Injection: send + auto-attach (renderer)  ∥

- [x] **S3-1. "Send now" seam.** Add `requestPrompt(text)` (text + bumping nonce) to
      [session-store.ts](../../src/app/session-store.ts); `ChatView` effect watches the nonce
      and calls `send(text)`. Guard against double-send; **no-op while busy**.
- [x] **S3-2. Send buttons in the tab.** "Send to agent" (whole pad) and, when the editor has
      a non-empty selection, "Send selection" (read from the `EditorView` ref). Both call
      `requestPrompt(...)`, **no-op on empty / while busy, and do not clear the pad**.
- [x] **S3-3. Auto-attach toggle.** Per-workspace flag (`scratchpadAttach: Record<cwd, bool>`)
      in [shell/store.ts](../../src/shell/store.ts), surfaced as a toggle in the tab header.
- [x] **S3-4. Wire auto-attach into send.** In `ChatView.send(text)`: if the toggle is on
      for this cwd, read the pad and pass `wrapForPrompt(text, pad)` to `agent.prompt`,
      while `pushUser`/transcript persist only `text`. Render a **clickable** composer chip
      ("Scratchpad attached") when on + non-empty that toggles attach off — reachable even
      when the panel is closed.
- [x] **S3-5. ⌘K command.** Add a "Send scratchpad" command to the
      [CommandPalette](../../src/shell/CommandPalette.tsx) that calls `requestPrompt(pad)`
      (disabled when empty / no session).
- [x] **S3-6. Gates + visual.** Typecheck / lint / 135 tests / build green
      ([scratchpad.test.ts](../../src/app/scratchpad.test.ts) covers wrap/clamp). Verified live:
      "Send to agent" produced a clean user bubble ("Remember: …", no fence) and the agent
      replied recognizing *"a scratchpad note"* — proof the fenced pad reached it via
      auto-attach. Auto-attach toggle shows its active state; the composer "Scratchpad
      attached" chip appears with a dismiss ×; ⌘K lists "Send scratchpad to agent".

## Phase S4 — Make the agent aware (optional) + docs

- [x] **S4-1. Tell the agent the path (read-only).** Add one line to the managed context
      block ([soul/managed-block.ts](../../electron/main/soul/managed-block.ts) → CLAUDE.md /
      AGENTS.md): a user scratchpad may exist at `.hearth/scratchpad.md` — the agent may
      **read** it for context but must **not** write to it (it's the user's notes).
- [x] **S4-2. Docs.** Note the feature + the `.hearth/scratchpad.md` convention where the
      other panel tabs are documented.

---

## Risks / edge cases

- **Concurrent edit in both bars** at once: debounced autosave + reload-on-focus is
  last-write-wins. Acceptable for a notepad; not worth locking.
- **User-workspace `.hearth/`** is untracked (not in the user's gitignore). Out of the way,
  and hidden from the Files tab (S1-1), but worth the one-line docs mention (S4-2).
- **Session resume** into a fresh agent process doesn't replay prior scratchpad context the
  agent saw (only typed text persists). Fine in practice — the pad is still on disk and
  re-attaches on the next turn if the toggle is on.
- *(Resolved into tasks: size cap → S1-2/S2-2; auto-attach being forgotten → clickable chip
  S3-4; tag escape → fenced wrap S1-2; cwd-switch write race → S2-2.)*

## Out of scope (v1)

- Structured / multi-item scratchpads, per-session pads, reordering, checkboxes.
- Syncing pad content into the chat transcript or History.
- Agent-authored scratchpad entries (the pad is user-only, read-only to the agent).
- A composer-adjacent quick-add affordance (tab + ⌘K only for now).
