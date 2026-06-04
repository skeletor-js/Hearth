# Agent presence

The agent should feel like a coworker living in Hearth, not a chatbot in a side
panel. You should sense it working when you're not staring at it, know which
session needs you, and — on the surfaces the agent acts on *spatially* (the
browser, the editor) — watch it move.

Hearth already emits everything presence needs. The agent streams a rich
`SessionUpdate` feed (`electron/shared/protocol.ts`): thoughts, tool-calls with
`pending/running/done/error` status, diffs tagged with file path, plans, usage,
`end`. That *is* presence data. Today it only flows into the single active
session and dies the moment you look away. This plan surfaces it everywhere it's
useful, and adds spatial presence where the agent shares a canvas with you.

## The core constraint

`AgentUpdatePayload` and `PermissionRequestPayload` both already carry a
`sessionId` (`protocol.ts`), but `src/app/chat/ChatView.tsx` ignores it and
attributes every update to the *active* session. That's safe today only because
routines navigate and **replace** the active session
(`src/app/routines/runner.ts`), so exactly one session is ever live. Presence
inherently breaks that — a routine grinding while you work in another session is
the whole point. So the foundation must route events by `sessionId`. Doing that
also fixes a latent bug: a background turn currently corrupts the active
transcript.

## Principle: presence must carry information, not theater

Every presence pixel must correspond to a real agent action with a real meaning
(and, for spatial presence, a real location):

- Browser click at (x, y) → **yes**, draw a cursor there.
- Editor diff → **yes**, but as a highlighted line *range*, not a fake caret.
- Chat / rail → ambient status only. No wandering cursors.

What we explicitly do **not** build: a character-by-character "typing" caret in
the editor (the agent emits whole diffs, not keystrokes — animating a caret
would lie about what happened), a cursor that roams surfaces the agent isn't
acting on, or anthropomorphic mascot theater that carries no signal. The flame
is enough personality; everything else is a signal you can act on.

---

## P0 · Foundation: presence store + sessionId-correct streaming

The one piece of real plumbing. Everything else renders off it.

**New `src/app/presence-store.ts`** — zustand, in-memory (derived, never
persisted), keyed by sessionId:

```ts
type PresenceStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'done'
interface SessionPresence {
  status: PresenceStatus
  label: string | null                         // "editing SystemSections.tsx", "running tests"
  recentFiles: { path: string; range?: [number, number]; at: number }[]  // ring buffer; range for P7
  pendingPermission: PermissionRequest | null  // P2
  edits: number                                // diffs this run, for P5 recap
  startedAt: number | null
  finishedAt: number | null
  unread: boolean                              // finished while not active, for P5
}
```

**New shell-level bridge `usePresenceBridge()`** — mounted once in
`src/routes/__root.tsx`, the single owner of `agent.onUpdate` +
`permission.onRequest`, keyed by `payload.sessionId`. Status derivation from
events we already emit:

- `thought` / `message` streaming → `thinking`
- `tool-call` `running` → `working`, `label = u.title`
- `diff` → push `{ path, range, at }` to `recentFiles`, `edits++`
- `permission:request` → `waiting`, stash `pendingPermission`
- `tool-call` `error` / `agent.onError` → `error`
- `end` → `done`, settle to `idle`; set `unread` if `sessionId !== active`

**Refactor `ChatView.tsx`:** filter `onUpdate` / `onRequest` to
`payload.sessionId === active.id`. Derive the composer `busy` from
`presence[active.id].status` so switching away and back keeps the right state.
The tiered auto-approval logic moves **into the bridge** so background sessions
get approved/prompted correctly; ChatView just renders the active session's
pending ask.

**Known limitation:** presence is in-memory, so a self-mod renderer reload wipes
it. The active session rehydrates (transcript replay + busy); a background
session's live status is lost on reload. Acceptable for v1 — not solved here.

---

## Ambient presence

### P1 · Rail status dots — highest leverage

`src/shell/Rail.tsx` recents read `presence[m.id]` and render a status dot +
optional micro-label, replacing the static `chat-circle`: pulsing dot for
`working`/`thinking`, quiet for `idle`, accent badge for `waiting`, warn for
`error`. New CSS in `src/styles/hearth.css`, pulse gated on
`data-reduce-motion`. This is what makes background and routine sessions visible
at all.

### P2 · Global "waiting on you"

The bridge holds `pendingPermission` per session. Add a shell-level surface in
`__root.tsx` chrome: a badge ("1 agent needs you") + a toast that deep-links —
clicking activates that session and scrolls to its `ApproveCard`. ChatView's
`ApproveCard` stays, now fed from `presence[active.id].pendingPermission`. The
tap-on-the-shoulder signal; also fixes the misattribution bug for free.

### P3 · Living flame

New `<StatusFlame>` in `src/shell/Mascot.tsx`, mapping the active (or aggregate)
status to visuals we already have: steady `FlameMark` idle, `ThinkingEmber`
flicker thinking, busier `AsciiEmber` working, accent shift waiting, warn error.
Swap it into the Rail brand and the chat empty state. Cheap, high-charm,
on-theme.

### P4 · Workbench file pulse

`recentFiles` is populated in P0. In `src/app/workbench/FilesTab.tsx` and the
Review tab badge, pulse a file row for ~2s when its `at` is fresh. The
which-file half of editor presence.

### P5 · "While you were away" recap

On session activate, if `presence[id].unread`, render a dismissible recap chip
atop the chat: "edited {edits} files · {duration} · finished {relative time}",
from fields P0 already accumulates. Clear `unread` on view.

---

## Spatial presence

The surfaces where the agent and the user share a visual canvas. This is where
the cursor idea is literally true for Hearth — and where the two surfaces need
very different treatment.

### P6 · Browser cursor — the marquee feature

The in-app browser is the truest "coworker at the screen" moment: the agent
performs *actual spatial actions* on a page you're both looking at (the "shared"
chip in `BrowserTab.tsx` already says so). A ghost cursor that glides to the
click point, ripples on click, highlights a field before it fills, and follows
scroll shows something true.

Plumbing:

- The `hearth` MCP browser handlers
  (`electron/main/agent-tools/hearth-mcp-server.mjs`, `agent-bridge.ts`) emit an
  action event on a new channel — `{ kind: 'click'|'fill'|'scroll'|'nav', x, y,
  selector? }`. They already have the target; this is cheap.
- Render the cursor in the **existing `OverlayWindow`**
  (`electron/main/windows/overlay-window.ts`, `src/overlay/`), **not** the React
  DOM. The native browser `WebContentsView` paints over the renderer, so a DOM
  cursor would hide behind the page; the overlay is the one layer already above
  it. This is why it's feasible — and why it's the biggest build (overlay
  coordinate mapping, action events, z-order edge cases). The overlay currently
  only paints the self-mod morph cover; it gains a cursor mode.

### P7 · Editor change-reveal — better first move

The agent does **not** type into CodeMirror (`FilesTab.tsx`) — it writes files
on disk and emits a `diff` with `oldText`/`newText`. So no fake caret. The
honest version:

- When the agent's `diff` lands for a file you have open, **live-reload it** and
  **scroll to + flash the changed line range** (the `range` carried on the P0
  `recentFiles` entry, computed from old vs new).
- Optional flourish: a deliberate "type-on" reveal of inserted lines, framed as
  a replay, never a pretend-live caret.

Bonus: this fixes a **real latent bug** — today if the agent edits a file you
have open, the editor keeps showing stale `open.content` and your `draft`
silently diverges from disk. The scratchpad markdown editor gets the same
behavior for free.

---

## Build order

1. **P0** — plumbing. The only hard part; everything else renders off it.
2. **P1, P2** — the substance: background work becomes visible (P1) and
   actionable (P2).
3. **P7** — low cost, real spatial presence, fixes the editor staleness bug.
4. **P3** — the feel.
5. **P4, P5** — polish.
6. **P6** — the demo-stealer, built last once P0's by-sessionId backbone and the
   overlay cursor layer are in place.

## Status: implemented

All phases shipped. Where each lives:

- **P0** — `src/app/presence-store.ts` (store + `changedRange`), `src/app/presence-bridge.ts`
  (shell-level stream owner + tiered auto-approval), mounted in `src/routes/__root.tsx`;
  `src/app/chat/ChatView.tsx` filters the stream by sessionId and derives busy/permission
  from presence. Tests: `src/app/presence-store.test.ts`.
  - **Load-bearing detail:** the agent stream is tagged with the *ACP protocol* session
    id, but the renderer keys everything (transcript, presence) by its own session id.
    `electron/main/ipc.ts` translates ACP id → renderer key (via
    `AgentHost.keyForAcpSession`) before sending `agent:update` / `permission:request`.
    Without this the by-sessionId filter drops every update — the transcript freezes and
    presence never lights up. The translation lives in `AgentHost` (connect's onUpdate /
    onPermission forwarders), so every consumer — the renderer AND the self-mod run
    tracker (`runForSession`, keyed by renderer id) — gets the renderer key. This also
    fixed the previously-dead self-mod attribution tap; lanes are now filtered to actual
    subagents (Task calls) via `RunTracker.markSubagent`, so the Agents panel + W1
    concurrency gate no longer treat every tool-call as a subagent.
- **P1** — `src/shell/Presence.tsx` (`PresenceDot`), wired into `src/shell/Rail.tsx`.
- **P2** — `src/shell/WaitingBanner.tsx` + a toast nudge from the bridge.
- **P3** — `StatusFlame` in `src/shell/Mascot.tsx`, `aggregateStatus` in `Presence.tsx`,
  driving the Rail brand.
- **P4** — file-tree row pulse in `src/app/workbench/FilesTab.tsx` + Files-tab nudge in
  `src/app/workbench/WorkPanel.tsx`.
- **P5** — recap chip in `ChatView.tsx`.
- **P6** — `electron/main/browser/browser-view.ts` (coords + `BrowserAction`),
  `agent-bridge.ts` (uses the new click/fill), `windows/overlay-window.ts`
  (`showPassive`/`sendCursor`), wired in `electron/main/index.ts`; cursor rendered by
  `src/overlay/BrowserCursor.tsx`. Channel `browser:cursor`, type `BrowserCursorEvent`.
- **P7** — `src/app/workbench/cm-flash.ts` + the change-reveal/disk-conflict handling in
  `FilesTab.tsx`.
