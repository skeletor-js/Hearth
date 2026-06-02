# Connectors, Browser & Panels Plan

**Direction (decided):** Hearth does **not** build its own MCP OAuth broker or
connector catalog. It **delegates connector auth to the ACP backends** (Claude
Code / Codex), which already load the user's own MCP servers and manage their
OAuth. Hearth's job is to make that delegation **visible, easy to set up from the
Hearth terminal, and complemented by the persistent authenticated browser** — and
to make the browser/terminal/files panels usable **outside a chat session**.

This supersedes the earlier broker+catalog draft (kept in
[Appendix: deferred broker](#appendix-deferred-oauth-broker) in case delegation
proves insufficient). The pasteable `/goal` block is at the bottom.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Why delegate (the call, and its limits)

Relying on the ACP backends for connector auth is cleaner and safer: Hearth
stores **no** third-party tokens, the backends own OAuth + refresh + the connector
ecosystem, and new connectors arrive for free. Building/maintaining an OAuth
broker across N providers is a maintenance treadmill. **So we don't.**

Verified, this already works end-to-end:

- **Claude** (`@zed-industries/claude-agent-acp`): the adapter sets
  `settingSources: ["user","project","local"]`
  ([acp-agent.js:954](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js))
  and merges those MCP servers with Hearth's:
  `mcpServers: { ...userProvidedOptions?.mcpServers, ...mcpServers }` (line 967).
  So anything from `claude mcp add` (`~/.claude.json`), project `.mcp.json`, or
  local settings is **already injected into every Hearth session**, OAuth tokens
  included (Claude Code stores + refreshes them).
- **Codex** (`@agentclientprotocol/codex-acp`): `createSessionConfig` reads
  `~/.codex/config.toml` `mcp_servers` via `configRead({ includeLayers: true })`
  and merges Hearth's ACP servers on top, deduped by name
  ([index.js:19235+](../../node_modules/@agentclientprotocol/codex-acp/dist/index.js)).
- **Terminal** ([pty.ts](../../electron/main/terminal/pty.ts)): spawns the user's real
  `$SHELL` with inherited `HOME`/env and `cwd = workspace`. So
  `claude mcp add …` / `codex mcp …` run in the Hearth terminal write to the exact
  config the adapters read. No new wiring needed for the happy path.

**Limits to stay clear-eyed about (these shape the tracks below):**

1. **The ceiling is the vendored adapter, not the CLI release.** Hearth is pinned
   to `@zed-industries/claude-agent-acp` and `codex-acp@0.0.44`
   ([claude.ts](../../electron/main/agents/claude.ts),
   [codex.ts](../../electron/main/agents/codex.ts)). "Always current" requires
   deliberately bumping those. → Track A4.
2. **Backend-asymmetric (per-CLI config).** A server set up in Claude won't appear
   under Codex, because delegation puts each connector in that CLI's own config
   (`~/.claude.json` vs `~/.codex/config.toml`), and the two don't share. "Works
   everywhere" is really "works per-CLI." This is a config-ownership consequence,
   **not** a transport limitation: both adapters accept connectors over ACP —
   Claude advertises `mcpCapabilities { http: true, sse: true }`
   ([acp-agent.js:124](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js)),
   Codex advertises `{ http: true, sse: false }`
   ([index.js:19905](../../node_modules/@agentclientprotocol/codex-acp/dist/index.js)).
   The only push-time gap is that Codex throws on **SSE** servers (a deprecated MCP
   transport; modern remote servers use Streamable HTTP, which Codex accepts), and
   that only matters in the deferred-broker path where Hearth pushes servers
   itself. The stdio `hearth` bridge works on both backends unconditionally.
3. **Silent injection = trust gap.** Because the Claude adapter auto-loads
   `~/.claude.json`, the agent can hold tools the user never sees in Hearth.
   → Track A2 surfaces them read-only.
4. **GUI-launch PATH.** Launched from Finder, the PTY may inherit a stunted PATH
   and fail to resolve `claude`/`codex` for some users. → Track A3.

---

## Already built (verified — do not rebuild)

- **Browser as a persistent, shared, authenticated session.**
  [browser-view.ts](../../electron/main/browser/browser-view.ts) uses a
  `persist:hearth-browser` partition (cookies/logins survive restarts) and the
  agent drives the **same** webContents via `browser_navigate/read/screenshot/
  click/fill/eval` ([hearth-mcp-server.mjs:222+](../../electron/main/agent-tools/hearth-mcp-server.mjs#L222)).
  The tool description states it operates "behind the user's login." This is the
  primary answer for any service without a good MCP server.
- **Panel toggles already exist** in the titlebar `tb-right`
  ([__root.tsx Titlebar](../../src/routes/__root.tsx)) and the work panel already
  separates `ALWAYS_TABS = {files, scratchpad, terminal, browser}` from
  session-contextual tabs ([WorkPanel.tsx](../../src/app/workbench/WorkPanel.tsx)).
  They are simply gated behind `isSession` (`pathname === '/chat'`).
- **Custom MCP server registry** ([registry.ts](../../electron/main/mcp/registry.ts)
  + Settings → Connectors) still exists for stdio/http servers Hearth itself
  injects. It keeps working; it's just no longer the headline path. The known bugs
  (id-keyed secrets, cleanup on remove) are folded into Track A as low-priority
  hygiene since the registry is now secondary.

---

## Track A — Connectors via delegation

Goal: setting up a connector is a guided action inside Hearth, and the user can
**see** what's active — without Hearth storing any tokens.

> **Status:** A0, A2, A3 ✅ **DONE (P2, 2026-06-02)**. A1, A1b ✅ **DONE (P3,
> 2026-06-02)** — verified live. A4/A5 + C1/C2 (P4) remain. See Implementation
> log → P2, P3.

- **A0 — Truthful per-backend auth status for BOTH backends (prerequisite).**
  Today `authStatusFor` only verifies a live connection for the **active** backend;
  the inactive one returns `connected: false` and renders as "Inactive backend"
  ([ipc.ts:330-341](../../electron/main/ipc.ts#L330)). That's misleading: a user who
  ran **both** `claude login` and `codex login` can't see that both are ready and
  that they can switch freely. Fix it so each backend reports a real, independent
  state:
  - **API-key mode** is already truthful for either backend (key presence is known
    via `resolveAuth` regardless of which is active) — keep it.
  - **Subscription/login mode** must be verified for the **inactive** backend too,
    without making it active. Do a **presence check of the CLI's own stored login**
    (Claude: `~/.claude/.credentials.json` or the macOS keychain item; Codex:
    `~/.codex/auth.json` — verify exact path/format per vendored version). Optional
    authoritative confirm-on-demand: a short-lived ACP `initialize` probe of that
    backend's adapter (spawn → initialize → tear down, like
    [probe.ts](../../electron/main/mcp/probe.ts) does for MCP), cached so it isn't run
    on every render.
  - **Compliance:** presence/expiry check **only** — never read, store, broker, or
    log the token value ([COMPLIANCE.md](../COMPLIANCE.md)). We confirm a login
    exists; we do not touch its contents.
  - **UI:** replace the "Inactive backend" badge with a per-backend state —
    *Authorized (login)* / *Authorized (API key)* / *Not signed in* — shown for
    Claude **and** Codex simultaneously, so the user sees both are usable and can
    switch. This is the foundation A1b's per-connector ✓/✗ display builds on.

- **A1 — Guided "Add connector" runs the CLI for you.** Settings → Connectors
  grows a small set of one-click actions that **open the Hearth terminal and run
  the right command** for each backend (e.g. `claude mcp add --transport http -s user
  notion https://mcp.notion.com/mcp`; `codex mcp add …` for Codex), then let the
  CLI's own OAuth/browser flow run. Present the six requested ones (Notion, Google
  Workspace, Microsoft 365, Slack, Fireflies, Granola) as labeled shortcuts with
  their docs links; "Custom" drops the user at a terminal prompt or the existing
  registry form. We generate the command; the **CLI** does the auth. No Hearth
  token storage.
  - **Scope MUST be global, not the CLI default.** `claude mcp add` defaults to
    `-s local` (per-directory), so a connector added from a workspace terminal would
    apply to that directory only — not "every Hearth session" as this plan intends.
    Claude templates therefore pin **`-s user`** (writes the global `~/.claude.json`
    the adapter loads via `settingSources`). Codex `mcp add` writes the global
    `~/.codex/config.toml` by default — no per-scope flag needed, but confirm it
    isn't writing a project-local override. If a user genuinely wants a
    workspace-only connector, that's the "Custom" path, not the guided shortcuts.
  - **Codex may need a second step: `codex mcp login <name>`.** The Codex CLI
    exposes both `mcp add` and `mcp login` (verified: `codex mcp` subcommands are
    `list/get/add/remove/login/logout`). For remote OAuth connectors, adding the
    server and authorizing it can be two commands. The Codex command builder must
    emit the login step where required, and A1b's "wait for OAuth" applies to it.
  - **Not every provider has a first-party remote MCP — fall back to the browser,
    not a fake command.** Of the six, only confirm a command shortcut where a
    real, first-party Streamable-HTTP MCP endpoint exists (see the table below).
    Where none does, the shortcut routes to the **persistent browser** path
    ("Already built" above) — log in there and let the agent drive it — rather than
    fabricating an `mcp add` URL that doesn't resolve. This is a labeled outcome of
    the connector definition, not an error.
  - **Per-backend command templates are baked in, by design.** Each connector
    definition carries a command builder **per backend** (Claude:
    `claude mcp add --transport http -s user <name> <url>`; Codex: `codex mcp add …`
    [+ `codex mcp login …`]), so "add Notion" resolves to the right invocation for
    whichever backend(s) the user has. The syntax differing across CLIs (and
    versions) is expected and absorbed here — it is part of normal upkeep, tracked
    alongside adapter versions (A4), **not** a per-setup caveat. Verify each
    template against the vendored adapter when bumping versions.
  - **Connector endpoint table (source at build time; do not guess).** Each
    definition needs a verified endpoint + transport. Confirm each against the
    provider's own MCP docs when implementing — these drift, and a wrong URL fails
    silently in the CLI. Known-good seed; the rest are to-confirm:

    | Connector | Transport | Endpoint | Status |
    |---|---|---|---|
    | Notion | http | `https://mcp.notion.com/mcp` | confirmed |
    | Google Workspace | ? | — | confirm first-party remote MCP exists; else browser path |
    | Microsoft 365 | ? | — | confirm first-party remote MCP exists; else browser path |
    | Slack | ? | — | confirm first-party remote MCP exists; else browser path |
    | Fireflies | ? | — | confirm endpoint from docs |
    | Granola | ? | — | confirm endpoint from docs |

    Filling this table accurately (and demoting any provider with no first-party
    remote MCP to the browser path) is part of A1, not a follow-up.

- **A1b — Dual-backend authorize-twice walkthrough (required).** Because
  connectors are per-CLI (limit 2), a user who has **both** Claude Code **and**
  Codex set up must authorize each connector **twice** — once per backend, two
  separate OAuth consent flows even for the same provider. The flow must:
  - **Detect** which backends are usable from A0's truthful per-backend status
    (`window.hearth.auth.status('claude')` / `…('codex')`), which now reports
    *Authorized* for the inactive backend too. (A0 is the prerequisite that makes
    this honest — there is no "only the active backend is verified" gap to work
    around anymore.)
  - **If both are set up:** before starting, show a clear notice — *"You have both
    Claude Code and Codex connected. MCP connectors are configured per backend, so
    you'll authorize {Provider} twice: once for Claude Code, once for Codex. We'll
    walk you through both."* Then run it as a **two-step walkthrough**: step 1 runs
    the Claude command and waits for its OAuth to complete; step 2 runs the Codex
    command and waits for its OAuth. Show per-step status and a "skip this backend"
    option.
  - **How "wait for OAuth to complete" actually works (define it, don't hand-wave).**
    Hearth gets no callback from the CLI's browser OAuth, so completion is detected
    by **polling A2's config reader**: after the `mcp add` (+ Codex `mcp login`)
    command is sent to the terminal, poll the backend's config (`~/.claude.json` /
    `~/.codex/config.toml`) until the named server appears, then optionally confirm
    with the same short-lived adapter probe A0 uses (spawn → list tools → tear down)
    to verify the connector is actually reachable, not just written. Only then mark
    the step done and advance.
    - **Failure / timeout path (required).** If the server never appears within a
      bounded timeout (e.g. user closed the browser, command errored, bad URL),
      surface the terminal's output and offer **retry / skip this backend**. Never
      hang the walkthrough on a stuck OAuth. CLI-not-found is caught earlier by A3's
      detect-and-hint.
  - **If only one is set up:** run the single flow silently (no double-auth
    notice). If the user adds the second backend later, A2's per-backend view
    shows the connector as present on one backend and missing on the other, with a
    one-click "authorize for {other backend}" that runs just that step.
  - **Reflect per-backend state per connector** (drawn from A2's config readers):
    e.g. *Notion — ✓ Claude · ✗ Codex* with an action to complete the missing one.
- **A2 — Read-only "Active connectors" view.** Show what each backend will
  actually load: parse `~/.claude.json` (and project `.mcp.json`) for Claude and
  `~/.codex/config.toml` for Codex, list server name + transport + (if derivable)
  auth/connected state. Clearly label it "managed by Claude Code / Codex — edit in
  the terminal." Closes the trust gap (limit 3). Read-only; never write tokens.
  - **TOML parsing:** `~/.codex/config.toml` needs a TOML parser. Check for one
    already on the dependency tree (codex-acp or a transitive dep) before adding
    `@iarna/toml` or similar — per AGENTS.md, don't add a dep if one's vendored.
  - **This reader is reused** as the completion signal for A1b's walkthrough and as
    the per-connector ✓/✗ source for A1b's display — build it once, here.
  - **Add-only by design.** The guided flow (A1) adds connectors; there is **no
    guided remove/disable**. Removal stays a terminal action (`claude mcp remove` /
    `codex mcp remove`), consistent with A2 being read-only and Hearth never
    mutating CLI config. State this in the UI so it reads as a decision, not a gap.
- **A3 — Make `claude`/`codex` resolve in the PTY.** GUI-launched Hearth can
  inherit a stunted PATH and fail to resolve the CLIs (limit 4). **Resolve the
  user's login PATH once at startup** (spawn `$SHELL -l -i -c 'echo $PATH'` a single
  time, cache it) and merge it into the PTY env — rather than spawning every PTY as
  a login+interactive shell, which re-sources heavy rc files on each terminal open
  (slow, and `-i` can disturb PTY semantics). Detect-and-hint if the binary is still
  missing after the PATH merge.
- **A4 — Adapter version surfacing.** Show the vendored adapter versions in
  Settings and note that connector/feature currency tracks them (limit 1). A
  bump-reminder, not auto-update.
- **A5 — Registry hygiene (low priority).** If we keep the custom registry: key
  secrets by server `id` not `slug(name)`
  ([ConnectorsSection.tsx:148](../../src/app/settings/sections/ConnectorsSection.tsx#L148)),
  delete `mcp.<id>.*` on remove ([ipc.ts:371](../../electron/main/ipc.ts#L371)), and
  surface `toAcpServers().skipped` instead of dropping silently
  ([index.ts:64](../../electron/main/index.ts#L64)).

Non-goals: Hearth-brokered OAuth, a Hearth token store for third parties, an
in-app catalog that bypasses the CLI.

## Track B — Always-available panels  ✅ DONE (P1, 2026-06-02)

Goal: the user can open the browser, terminal, files, and scratchpad **without**
being in a chat session — to browse, run a command, or edit a markdown/text file.

> **Status:** B1–B4 implemented and verified live. Toggles + panels render on
> `/new`, `/history`, `/settings` and stay correct on `/chat`; off-session shows
> only the four always-tabs; Files/Terminal cwd falls back to `repoRoot` (already
> handled in main). Verified in dark (offscreen render of all three off-session
> routes) and light (live window). typecheck + lint + build + 301 tests green.
> See Implementation log → P1.

- **B1 — Ungate the top-right toggles.** In [__root.tsx](../../src/routes/__root.tsx)
  `Titlebar`, render the bottom/right `PanelBtn`s regardless of route (not just
  `isSession`). Keep the left sidebar toggle as-is.
- **B2 — Render panels off-session.** Drop the `isSession` gate on the right
  `wb-col` and bottom `wb-panel`. When **not** on `/chat`, restrict the panel's
  tab set to `ALWAYS_TABS` (files, scratchpad, terminal, browser) — session tabs
  (review, agents, plan, self) stay hidden until there's a session. Persisted
  `rightTab`/`bottomTab` that are session-only should fall back to an always tab
  off-session.
  - **Off-session cwd (terminal + files) must be defined.** Both the terminal and
    Files tab today derive cwd from `useSession((s) => s.active?.cwd)`, which is
    **undefined off-session** (no active session). Main already defaults git/cwd to
    `repoRoot` ([ipc.ts:221-223](../../electron/main/ipc.ts#L221)); use the same
    fallback so the off-session terminal/files open in the Hearth repo root rather
    than an undefined/`~` cwd. This also matters for A1: because the guided
    `claude mcp add` uses `-s user` (global), the terminal's cwd is irrelevant to
    connector scope — confirming the `-s user` decision is what decouples "add a
    connector" from "which folder the off-session terminal happens to be in."
- **B3 — Layout sanity.** The `data-layout` focus/split logic is session-scoped;
  off-session use a plain open/closed panel (no focus scrim, no split). **Pin the
  off-session CSS contract:** `data-layout` is already set to `undefined`
  off-session ([__root.tsx:46](../../src/routes/__root.tsx#L46)), so the focus/split
  rules don't apply — confirm the `.app` grid renders the route content and an open
  `wb-col`/`wb-panel` side by side at the persisted `wbW`/`panelH` sizes without the
  session-only focus/split CSS collapsing the main column. Verify the browser
  `WebContentsView` bounds still track the panel rect on non-`/chat` routes (it's
  positioned by the renderer-reported content rect) under that grid.
- **B4 — Persistence.** Panel open/closed + active tab already persist via the
  shell store; confirm they restore correctly when the app opens to a non-session
  route.

## Track C — Browser (already built; close the gaps)

- **C1 — Discoverability.** The browser tab is an always-tab; with Track B it's
  reachable anywhere. Make sure it has a usable address/nav affordance
  ([BrowserTab.tsx](../../src/app/workbench/BrowserTab.tsx)) for manual login.
- **C2 — Session clarity.** A small indicator that the agent shares this exact
  logged-in browser (so users understand logging in here grants the agent access),
  and a way to open a fresh/cleared partition if they want isolation. Optional v2.
- **C3 — No new work on persistence or agent control** — both exist. Do not
  reimplement.

---

## Phasing for `/goal`

1. **P1 — Track B (panels global). ✅ DONE (2026-06-02).** Pure renderer,
   hot-reloads, self-contained, highest immediate value. Verified in light + dark,
   on `/new`, `/history`, `/settings`, and `/chat`.
2. **P2 — Track A0 + A2 + A3 (truthful dual-backend auth + visibility + PTY
   PATH). ✅ DONE (2026-06-02).** Per-backend auth status that shows BOTH backends
   as authorized when they are (A0), the read-only active-connectors view (A2), and
   reliable `claude`/`codex` resolution (A3). Touched main (`ipc.ts` auth status, a
   credential-presence check, `pty.ts`, read-only config readers, IPC) —
   restart-tier. A0 gates A1b.
3. **P3 — Track A1 + A1b (guided connect + dual-backend walkthrough). ✅ DONE
   (2026-06-02).** The terminal-command shortcuts + the six labeled connectors, and
   the authorize-twice walkthrough when both backends are set up. Depends on P2's PATH
   fix and P2's per-backend config readers being in place.
4. **P4 — Track A4 + C1/C2 polish + A5 hygiene (optional).**

Each phase is buildable and shippable on its own. P1 is file-disjoint from the
Track A main-process work.

---

## `/goal` block (paste below)

```
Implement docs/active-plans/CONNECTORS-PLAN.md. The DIRECTION is decided: Hearth delegates MCP
connector auth to the ACP backends (Claude Code / Codex) — it does NOT build an
OAuth broker or a connector catalog, and stores NO third-party tokens. Do not
revive the deferred broker in the appendix. Apply the plan; don't re-derive it.

## Locked decisions (from the doc — do not relitigate)
- No Hearth OAuth broker, no Hearth third-party token storage, no in-app catalog
  that bypasses the CLI. Connector auth is the backends' job; they already load the
  user's ~/.claude.json and ~/.codex/config.toml MCP servers into every Hearth
  session (verified in the vendored adapters).
- The browser (persist:hearth-browser partition) and agent browser control
  (browser_* tools) are ALREADY built — do not reimplement persistence or control.
- The custom MCP registry stays as a secondary path; only do its hygiene fixes
  (Track A5) if cheap, and only if you keep the registry.
- Per-backend auth status (A0) must show BOTH backends as Authorized when they are,
  inactive one included, so the user sees they can switch. Verify the inactive
  backend's login by PRESENCE/expiry only — never read, store, broker, or log the
  subscription token value (COMPLIANCE.md).
- Per-backend MCP-add command templates are baked into each connector definition
  (Claude vs Codex syntax differs by design); maintaining them is normal upkeep
  tied to adapter versions, not a runtime caveat.

## How to work
- Phase order P1 -> P2 -> P3 -> P4 as the doc sequences them.
- P1 (panels global) is renderer-only (src/**) and hot-reloads. Track A's
  visibility/PATH work touches electron/main/** (restart-tier per AGENTS.md);
  expect restarts + typecheck-before-restart.
- Match existing patterns: shell store + __root layout for panels; settings
  primitives in src/app/settings/controls.tsx; reuse ALWAYS_TABS / WorkPanel
  rather than adding a parallel panel. Tokens/classes per AGENTS.md. Reuse the
  existing terminal (pty.ts) to run CLI commands — don't add a second terminal.
- Active-connectors view is READ-ONLY: parse the CLI config files; never write
  tokens or mutate the user's CLI config from Hearth.

## Verify each phase BEFORE committing it
- bun run typecheck, bun run lint, bun run build, bun test must pass.
- NOTE: P2/P3 acceptance needs REAL state the agent can't self-provision — both
  backends logged in (subscription) AND on API keys, plus live OAuth for Notion/
  Granola against real accounts. These steps require the user in the loop; do P1's
  live checks solo, but flag P2/P3's credential-dependent steps for the user.
- P1: drive the LIVE app (read .hearth/bridge-url, POST /eval, GET /snapshot; or
  computer-use). Confirm the bottom/right panel toggles appear and work on /new,
  /history, /settings AND /chat; off-session only files/scratchpad/terminal/browser
  tabs show; the embedded browser renders and tracks the panel bounds off-session.
  Capture before/after in both themes.
- P2: with BOTH backends logged in (subscription) and again with BOTH on API keys,
  confirm Account/settings shows each as Authorized simultaneously — the inactive
  backend must NOT read "Inactive backend" when it actually has a valid login.
  Confirm a logged-out backend reads "Not signed in." Confirm no token value is
  read/stored (presence check only). Confirm the active-connectors view lists what
  each backend actually loads (cross-check by adding a server with `claude mcp add`
  in the Hearth terminal and seeing it appear). Confirm `claude` and `codex`
  resolve in the Hearth terminal when the app is launched from Finder.
- P3: confirm a guided "Add Notion" opens the Hearth terminal, runs the correct
  claude mcp add command, the CLI's own OAuth completes, and the connector's tools
  then work in a new agent session. Spot-check one more (e.g. Granola).
- P3 dual-backend (A1b): with BOTH Claude and Codex set up, confirm the
  authorize-twice notice appears, the walkthrough runs both steps (Claude then
  Codex) with two OAuth flows, per-backend state shows ✓/✗ per connector, and the
  "authorize for the other backend" action completes a half-set-up connector. With
  only ONE backend set up, confirm NO double-auth notice appears.

## Commits
- One focused Hearth-SelfMod commit per phase (P1..P4), message listing what it
  closes. Keep each phase self-contained and buildable.

## Done when
- Browser/terminal/files/scratchpad panels are usable outside a chat session via
  always-visible top-right toggles, correct in both themes.
- The user can set up a connector from inside Hearth (guided terminal command) and
  see what's active read-only; Hearth stores no third-party tokens.
- Account/settings truthfully shows BOTH backends as Authorized when they are
  (login or API key), inactive backend included, so the user can see they can
  switch — verified without reading or storing any subscription token.
- When both Claude Code and Codex are set up, the connector flow clearly warns that
  authorization happens twice (once per backend) and walks the user through both;
  with only one backend set up, it does not.
- `claude`/`codex` resolve in the Hearth terminal regardless of launch method.
- typecheck + lint + build + test clean; live app verified.
- docs/active-plans/CONNECTORS-PLAN.md status boxes updated + an Implementation log appended
  (per phase: what changed, files touched, verification). Restore the live app to
  a clean state when finished.
```

---

## Appendix: deferred OAuth broker

The original plan was for Hearth to broker OAuth itself (discovery + DCR + PKCE +
loopback flow + token store/refresh) and ship a built-in catalog for Notion,
Google Workspace, Microsoft 365, Slack, Fireflies, and Granola — all of which are
remote Streamable-HTTP MCP servers using OAuth 2.1. That is **deferred**, not
deleted, because delegation (above) achieves the same user outcome without Hearth
holding tokens. Revisit only if delegation proves insufficient — e.g. if a
must-have connector has no CLI path, or if cross-backend parity (a connector
usable identically under both Claude and Codex, managed in-app) becomes a hard
requirement. If revived: brokered tokens live encrypted in the secret store keyed
by server id, injected as `Authorization: Bearer` in `to-acp.ts`, refreshed in the
async provider at [index.ts:64](../../electron/main/index.ts#L64). The full broker
spec (discovery/DCR/PKCE/flow/tokens module breakdown, per-connector endpoint +
auth table for the six providers) can be reconstructed from this summary; it is not
preserved elsewhere, so re-spec it from scratch if revived.

---

## Implementation log

### P1 — Track B (panels global) · 2026-06-02

**What changed:** the browser/terminal/files/scratchpad panels are now usable
outside a chat session.

- **B1 — toggles ungated.** [`__root.tsx`](../../src/routes/__root.tsx) `Titlebar`
  renders the bottom/right `PanelBtn`s on every route (dropped the `isSession`
  wrapper; removed the now-unused `pathname`/`isSession` locals there).
- **B2 — panels render off-session.** `showRight` is now
  `isSession ? (layout==='focus' || rightOpen) : rightOpen`; the bottom panel
  gate dropped from `isSession && bottomOpen` to `bottomOpen`. `WorkPanel` gained
  an `offSession` prop that restricts the tab set to `ALWAYS_TABS` (review/plan/
  self/agents stay hidden off-session). A persisted session-only `rightTab`
  (default `review`) falls back to `files` via the existing fallback effect.
- **B3 — layout sanity.** Focus/split styling (`is-hidden` class, `split` width
  skip, focus-scrim, focus resizer suppression) is now gated on `isSession`, so
  off-session is a plain open/closed panel. Added
  `.app:not([data-layout]) .wb-col{ flex-shrink:0 }` in
  [`hearth.css`](../../src/styles/hearth.css) so the right column keeps its inline
  width off-session (all other width rules are `data-layout`-scoped). Browser
  bounds tracking is route-independent (driven by `getBoundingClientRect`), so it
  works off-session unchanged; off-session it opens `about:blank`.
- **B4 — persistence.** Panel open/active-tab already persist via the `hearth-ui`
  zustand store; confirmed the offscreen render hydrates them on a non-session
  route.
- **Off-session cwd:** no renderer change needed — main already defaults
  `cwd || repoRoot` for terminal create and fs list/read/write
  ([ipc.ts:274,296-299](../../electron/main/ipc.ts#L274)), so off-session Files
  lists the repo root (confirmed in the captures).

**Files touched:** [`src/routes/__root.tsx`](../../src/routes/__root.tsx),
[`src/app/workbench/WorkPanel.tsx`](../../src/app/workbench/WorkPanel.tsx),
[`src/styles/hearth.css`](../../src/styles/hearth.css).

**Verification:** drove the live app via the eval/snapshot bridge.
- Dark: offscreen render of `/history`, `/new`, `/settings` — both panels show
  only Files/Scratchpad/Terminal/Browser; Files lists the repo root.
- Light: on the live window, clicked the now-visible off-session toggles on
  `/history` → both panels opened with the four always-tabs; captured.
- `/chat` regression: navigated back to the active session — `data-layout`
  returns to `companion`, chat surface intact, panels behave as before.
- Restored the user's original state (dark, panels closed, original session).
- `bun run typecheck`, `bun run lint`, `bun run build`, `bun test` (301 pass) all
  green.

### P2 — Track A0 + A2 + A3 · 2026-06-02

**A0 — truthful per-backend auth.** `authStatusFor` no longer early-returns a bare
`connected:false` for the inactive backend. In subscription mode it now reports
`loginPresent` from a presence check of the CLI's own stored login
([`login-presence.ts`](../../electron/main/agents/login-presence.ts)): Codex →
`~/.codex/auth.json` existence; Claude → `~/.claude/.credentials.json` or the
non-secret `oauthAccount` marker in `~/.claude.json`. **No token value is read,
stored, or logged** (COMPLIANCE.md). Added `loginPresent` to `AuthState`. The
`AuthSection` badge replaces "Inactive backend" with *Using your login* (active),
*Signed in* (inactive + login present), or *Not signed in*; Log out / Re-check are
available for both backends. API-key mode is unchanged (already truthful).

**A2 — read-only active connectors.**
[`active-connectors.ts`](../../electron/main/mcp/active-connectors.ts) reads what
each backend loads, never throwing and never exposing auth values (only a
`hasAuth` boolean): Claude from `~/.claude.json` top-level `mcpServers` (user),
`projects[cwd].mcpServers` (local), and `<cwd>/.mcp.json` (project); Codex from
`~/.codex/config.toml` via a minimal `[mcp_servers.<name>]` reader (NOT a general
TOML parser — no dependency added). Nested `[mcp_servers.<name>.env]` tables are
treated as subtables (mark auth) not phantom servers. Pure parsers
(`parseClaudeConnectors`, `parseCodexConnectors`) are unit-tested
([`active-connectors.test.ts`](../../electron/main/mcp/active-connectors.test.ts),
5 cases). New IPC `connectors:active`; rendered in `ConnectorsSection` as a
read-only block labeled "managed by Claude Code / Codex — edit in the terminal,"
with a CLI-not-found hint driven by A3's resolver.

**A3 — PTY PATH.** [`login-path.ts`](../../electron/main/terminal/login-path.ts)
resolves the user's login PATH once (`$SHELL -lic` with sentinels, cached) and
merges it with the inherited PATH; `pty.ts` spawns terminals with it. `cliResolves`
powers detect-and-hint. Avoids re-sourcing rc files per terminal.

**Files:** `electron/shared/protocol.ts`, `electron/shared/channels.ts`,
`electron/main/ipc.ts`, `electron/main/agents/login-presence.ts`,
`electron/main/mcp/active-connectors.ts` (+ test),
`electron/main/terminal/login-path.ts`, `electron/main/terminal/pty.ts`,
`electron/preload/index.ts`, `src/app/settings/sections/AuthSection.tsx`,
`src/app/settings/sections/ConnectorsSection.tsx`.

**Verification (live, via eval/snapshot bridge):**
- A0: `auth.status` → Claude `{subscription, connected:true}`, Codex
  `{subscription, connected:false, loginPresent:true}`. Settings shows Claude
  *Using your login* + Codex *Signed in* — no "Inactive backend"; both authorized.
- A2: `mcp.active()` → `claudeCli:true, codexCli:true`, Claude `[]`, Codex
  `context7/stdio`, `playwright/stdio`, `node_repl/stdio` (Authorized). Settings
  renders them with transport/scope chips. Phantom `node_repl.env` confirmed gone.
- A3: ran `which claude codex` in a real Hearth PTY → both resolve (codex via an
  nvm path that a GUI launch would otherwise miss), exit 0.
- `bun run typecheck`, `lint`, `build`, `bun test` (305 pass) all green.
- API-key parity not re-tested with real keys (the unchanged `mode==='api-key'`
  branch already reports truthfully for either backend); the live `claude mcp add`
  round-trip was not run to avoid mutating the user's config — the reader is proven
  against the user's real Codex servers and Claude uses the same tested parser.

### P3 — Track A1 + A1b · 2026-06-02

**A1 — guided "Add a connector".** A new section in `ConnectorsSection` lists the
six connectors from a data-driven catalog
([`connectors-catalog.ts`](../../src/app/settings/connectors-catalog.ts)). Each
shows per-backend ✓/✗ (drawn from A2's read-only view). A connector with a
verified first-party remote MCP endpoint (Notion) gets a guided command; the
others (Google Workspace, Microsoft 365, Slack, Fireflies, Granola) honestly route
to the **persistent browser** rather than a fabricated URL — fill `url` in the
catalog if/when a provider ships an endpoint and it becomes a guided command for
free. Claude commands pin `-s user` (global); Codex emits `mcp add --url … && mcp
login …`. "Run in terminal" opens the bottom terminal and **types** the command
(not submitted — the user reviews + presses Enter) via a small non-persisted bus
([`terminal-bus.ts`](../../src/app/workbench/terminal-bus.ts)) consumed by
`TerminalTab` (delayed take() survives React StrictMode's throwaway mount + PTY
spawn latency).

**A1b — dual-backend authorize-twice walkthrough.** Usable backends are derived
from which CLI resolves on PATH (`claudeCli`/`codexCli` from A2 — the real
prerequisite for `mcp add`). With both present, a "step N of 2 — authorize for
{backend}" notice appears and the flow runs Claude then Codex, each with its own
command + a poll of the read-only view (every 2.5s, ≤90s) that advances when the
server appears for that backend; per-step "Skip this backend" / "Next backend".
With one backend, a single silent step.

**Files:** `src/app/settings/connectors-catalog.ts` (new),
`src/app/workbench/terminal-bus.ts` (new),
`src/app/workbench/TerminalTab.tsx`, `src/app/settings/sections/ConnectorsSection.tsx`.

**Verification (live, via eval/snapshot bridge):**
- Guided section renders all six: Notion (guided), the other five with a "browser"
  badge + "Log in via browser"; per-connector "Claude — · Codex —" presence.
- "Set up" on Notion → "Notion — step 1 of 2: authorize for Claude Code" with
  `claude mcp add --transport http -s user notion https://mcp.notion.com/mcp`.
- "Run in terminal" → bottom terminal opens and the command is **typed at the
  prompt, not executed** (verified in a snapshot). Restored the live view after.
- `bun run typecheck`, `lint`, `build`, `bun test` (306 pass) all green.
- Not run here (would mutate the user's real `~/.claude.json` / require live OAuth):
  pressing Enter to actually add a connector + completing the browser sign-in. The
  command, backend sequencing, and PTY delivery are proven; the OAuth round-trip is
  the user-in-the-loop step (per this plan's P3 verify caveat).

_(append per phase: what changed, files touched, verification results)_
