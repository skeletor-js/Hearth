# Plan — finish the two deferred caveats (P5-3 + P6-1)

Closes the two honest gaps left after the UI build ([UI-PLAN.md](UI-PLAN.md)):

- **Track A — P5-3:** **per-model select** for the two backends. The ACP protocol
  exposes the model list; we just weren't reading it. **Scope decision (locked): Hearth
  supports exactly Claude Code and Codex. No arbitrary/third-party ACP connectors** —
  the registry / `AgentKind` generalization / "connect a server" form are explicitly out.
- **Track B — P6-1:** History — **Model-A redo** (revert-the-revert) and **revert-conflict
  auto-resolve** (hand the conflict to Hearth's own agent), with the clean-tree guard.
  Undo already ships; this finishes the model per [SELF-EVOLUTION-HISTORY.md](../SELF-EVOLUTION-HISTORY.md).

The two tracks are independent (file-disjoint) and can be run as one `/goal` or two.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Grounding (current state — verified)

- `AgentKind = 'claude' | 'codex'` stays as-is. `createAgent(kind)` in
  [electron/main/index.ts](../../electron/main/index.ts) hard-builds `ClaudeAgent`/`CodexAgent`; no change.
- ACP SDK exposes models: `NewSessionResponse.models` → `SessionModelState`
  (`availableModels: ModelInfo[]`, `currentModelId`) and a `session/set_model` method
  (`connection.setSessionModel`). `AcpClient.newSession` currently ignores `models`.
- `AgentHost` keys ACP sessions by renderer-session id and exposes `kind`/`prompt`/
  `cancel`/`switchTo`. It can cache the latest model state per kind.
- `revertCommit` does `git revert --no-edit <hash>` and **throws** on conflict.
  `recentSelfMods` lists `Hearth-SelfMod` commits and derives `reverted` from
  "This reverts commit …". History undo calls `selfMod.undo(hash)`; redo + conflict
  handling are not built.

---

## Decisions (locked)

- **Two backends only.** No ACP-server registry, no `AgentKind` widening, no connect
  form. The backend popover stays Claude / Codex.
- **Model select is real:** read `availableModels`/`currentModelId` from the new-session
  response; switching calls `session/set_model`. A backend that reports no models shows a
  single "Default" entry and the picker is inert.
- **Where models come from without spawning extra work:** `AgentHost` caches the latest
  `{available, current}` captured on the most recent `newSession` for the current kind.
  The app always has an active session after onboarding, so the cache is populated; before
  the first session it's empty → "Default".
- **Model switch scope = both:** a chosen model is applied to the **active** session
  immediately (`set_model`) and remembered as the **preferred** model for that kind, then
  re-applied to future new sessions of that kind (in-memory for now; persistence is a
  minor follow-up).
- **History redo = Model A revert-the-revert** (signed off). Logical applied/undone state
  derives from net reverts; redo reverts the newest revert that targeted the commit.
- **Conflict → auto-hand to Hearth's agent** (signed off). On a revert conflict: keep the
  conflicted tree, send Hearth's agent a turn to resolve + commit; **fallback** `git
  revert --abort` + a clear message if no backend is connected or it can't.
- **Clean-tree guard** before a step; if dirty, surface "commit or discard first" rather
  than clobbering.
- **Verification protocol = same as UI-PLAN** (typecheck/lint/test/build + boot + visual;
  TDD the logic; checkpoint commit per phase; never commit red).

---

## Track A — Per-model select (Claude / Codex only)  ∥

- [x] **A-DONE. Model capability (main).** In `AcpClient.newSession`, capture the response
      `models` (available + current); add `availableModels()` / `currentModel()` /
      `setModel(modelId)` (→ `connection.setSessionModel`). `AgentHost` caches the latest
      `{available, current}` per kind, exposes `getModels()` + `setModel(id)` (applies to
      the active session + remembers the preferred model for the kind, re-applied on new
      sessions), and broadcasts a models-changed event. IPC `agent.getModels` /
      `agent.setModel` (+ a `agent:models:changed` push). **TDD** the pure translation:
      a fake new-session response with/without `models` → normalized `{available[],
      currentId}`; empty when absent. *Accept:* models round-trip; setModel issues the ACP
      call on the active session; no-models backend → `{available:[], current:null}`.
- [x] **A-DONE. ∥ Model-select UI (renderer).** Settings → Agent "Default model" becomes a
      real `<select>` populated from `agent.getModels()` for the current backend, with the
      current model selected; onChange → `agent.setModel`. Also surface the model under the
      current backend in the **composer backend popover** (per-session switch). Re-fetch on
      backend change / models-changed. Falls back to a single "Default" option when empty.
      *Accept:* with a live session, the picker lists the backend's real models, selecting
      one switches the session's model; reflects across Settings + popover.
- [x] **A-DONE. Gates + visual (Settings model select + popover, both themes); checkpoint commit.**
      Mark UI-PLAN **P5-3** `[x]` (scoped to the two backends; arbitrary ACP explicitly out).

---

## Track B — History: redo + revert-conflict auto-resolve  ∥

- [x] **B-DONE. Model-A redo (git + service).** Add `findRevertOf(repoRoot, hash)` (newest
      `git revert` commit whose body says "This reverts commit <hash>") and
      `SelfModService.redo(hash)` = revert-the-revert (re-applies). Logical state
      (`applied | undone`) derives from net reverts (extends today's `reverted`). **TDD**
      the net-effect model: commit → undo → redo → undo across multiple edits resolves to
      the correct applied/undone set. *Accept:* redo re-applies an undone self-edit; state
      is correct after interleaved undo/redo.
- [x] **B-DONE. ∥ Conflict detection + clean-tree guard + agent hand-off (service).** Make the
      revert path return `{ ok, commit }` | `{ conflict: true, files[] }` instead of
      throwing (detect via nonzero exit / `git diff --name-only --diff-filter=U`); a
      clean-tree guard (reuse `listDirty`) before stepping. On conflict: build a resolve
      prompt and hand it to the agent host in the Hearth session — "Undoing '<subject>'
      conflicts with a later change to <files>; complete the revert and resolve the
      conflict." Fallback: `git revert --abort` + a structured error. **TDD** the
      guard + the conflict shape (force a conflicting revert in a temp repo). *Accept:* a
      conflicting undo doesn't throw; returns a routable conflict; abort leaves a clean tree.
- [x] **B-DONE. History UI: redo + conflict flow (renderer).** Undone commits get a **Redo**
      button (→ `selfMod.redo`); a conflict result shows "Hearth is resolving this revert…",
      kicks the agent turn, and toasts the outcome; dirty tree → the guard message. Keep
      the `Hearth-Kind` Code/Personality/Memory filter. *Accept:* undo→redo round-trips
      live; a forced conflict routes to the agent (or shows the abort fallback).
- [x] **B-DONE. Gates + visual (History redo + conflict states); checkpoint commit.**

---

## Parallelization & DoD

Tracks A and B are independent. Within B, do B-1 then B-2 (both touch git.ts /
self-mod-service) to avoid churn. Each track: small channels/preload/IPC seam first, then
UI. Done = both tracks green on `bun run typecheck && bun run lint && bun test && bun run
build`, booting clean, visually verified, logic TDD'd, checkpoint-committed per phase.
