# Hearth ACP & Session Surface Plan

Hearth talks to its backends over the Agent Client Protocol (ACP). The protocol
exposes far more than Hearth uses today — session persistence, richer prompt
input, a terminal capability, usage metering, live mode control, structured
elicitation, generic config options, and more. At the same time the session/
composer UX has real bugs: the rail's "New session" doesn't start a session, the
branch chip is hardcoded, and the Plan/Auto/Ask toggle is cosmetic (mode is never
sent to the agent).

This plan unifies both. It catalogs **what ACP offers, what Hearth uses today, and
the concrete ways to leverage the rest**, then sequences the work as one roadmap:
fix and rebuild the session/composer surface first (Phase 1), because that surface
is where most of the remaining ACP leverage plugs in, then layer the additive
workstreams (Phases 2–4) on top.

> This document merges two former backlog plans (`ACP-LEVERAGE-PLAN.md` and
> `HOME-NEWSESSION-COMPOSER-PLAN.md`). Where they overlapped — usage metering,
> live permission mode, generic config options — there is now one owner: Phase 1B.

Connector/MCP leverage is covered separately in
[CONNECTORS-PLAN.md](../completed-plans/CONNECTORS-PLAN.md) and only cross-referenced
here (W10).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## How the stack actually works (verified)

- **ACP → Claude Agent SDK → Claude Code engine.** The Claude adapter
  (`@zed-industries/claude-agent-acp`) imports `query`, `listSessions`,
  `getSessionMessages` from **`@anthropic-ai/claude-agent-sdk@0.2.83`**
  ([acp-agent.js:2](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js))
  and drives the SDK's `query()` (which bundles the Claude Code `cli.js`). It is
  **not** the interactive `claude` CLI. Codex is the analogous shape via its own
  app-server SDK. **Consequence:** subscription usage runs through the Agent SDK's
  **metered credit pool**, not the full interactive allowance — see
  [COMPLIANCE.md](../COMPLIANCE.md). This makes usage metering (Phase 1B / W4) more
  than cosmetic.

- **ACP wire surface (from the SDK schema).** Methods, verified present:
  `session/new · prompt · cancel · load · resume · fork · list · close ·
  set_mode · set_model · set_config_option · request_permission · elicitation ·
  update`; client-implemented `fs/read_text_file · fs/write_text_file`;
  `terminal/create · output · wait_for_exit · kill · release`. Streaming
  `session/update` kinds: `user_message_chunk · agent_message_chunk ·
  agent_thought_chunk · tool_call · tool_call_update · plan ·
  available_commands_update · current_mode_update · config_option_update ·
  session_info_update · usage_update`.

- **What the adapters advertise.**
  - Claude ([acp-agent.js:116-150](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js)):
    `promptCapabilities { image, embeddedContext }`, `mcpCapabilities { http, sse }`,
    `loadSession: true`, `sessionCapabilities { fork, list, resume, close }`.
  - Codex ([index.js:19893+](../../node_modules/@agentclientprotocol/codex-acp/dist/index.js)):
    `promptCapabilities { image }`, `mcpCapabilities { http, sse:false }`,
    `loadSession: true`, `sessionCapabilities { resume, list }`, `auth { logout }`.

- **What Hearth uses today (verified).**
  - Declares `clientCapabilities: { fs: { readTextFile, writeTextFile } }` but
    **gated to `HEARTH_MEDIATE_WRITES` (off by default)**, so in practice both fs
    caps are advertised `false`
    ([acp-client.ts:151](../../electron/main/agents/acp-client.ts#L151)); **no
    terminal capability** at all.
  - Sends **text-only** prompts: `prompt: [{ type: 'text', text }]`
    ([acp-client.ts:216](../../electron/main/agents/acp-client.ts#L216)); composer is a
    plain textarea ([Composer.tsx](../../src/app/chat/Composer.tsx)).
  - Handles `agent_message_chunk · agent_thought_chunk · tool_call ·
    tool_call_update · plan · available_commands_update`
    ([acp-translate.ts:99-168](../../electron/main/agents/acp-translate.ts#L99)) and
    **explicitly drops** `current_mode_update · config_option_update · usage_update`
    (the `default:` case at translate.ts:168).
  - `newSession()` reads only `res.models` — it **drops `res.modes` and
    `res.configOptions`** ([acp-client.ts](../../electron/main/agents/acp-client.ts)).
  - Uses `set_model` (the SDK's `unstable_setSessionModel` at
    [acp-client.ts:222](../../electron/main/agents/acp-client.ts#L222)) and `cancel`.
    **Does not** use `session/load · resume · fork · list` — every session is
    created fresh.
  - Pins permission mode by writing `.claude/settings.local.json` before connect
    ([claude.ts ensureProjectPermissionMode](../../electron/main/agents/claude.ts)),
    rather than driving `set_mode` live.
  - Rail `/new` link is labelled "New session" but routes to the **home screen**
    ([Rail.tsx:60](../../src/shell/Rail.tsx#L60), `src/routes/new.tsx HomeScreen`);
    it does not start a session.
  - Composer chip row renders branch hardcoded to `'hearth'`
    ([Composer.tsx:88](../../src/app/chat/Composer.tsx#L88)), a static Self-edit
    chip, and a Claude backend chip; the Plan/Auto/Ask `Seg`
    ([Composer.tsx:10](../../src/app/chat/Composer.tsx#L10)) is **local cosmetic
    state — `mode` is never sent to the agent**.

---

## "Computer use" — where it fits (the framing)

Computer use is **not** an ACP capability and not a native Claude Code feature —
ACP has no screen/mouse/keyboard primitive. It's an Anthropic *model/API* tool, and
it reaches an agent as an **MCP server** (the `mcp__computer-use__*` tools are
exactly that). So "computer use through ACP" = add a computer-use MCP server via the
connector path ([CONNECTORS-PLAN.md](../completed-plans/CONNECTORS-PLAN.md)); ACP just
carries the tool calls. Hearth already ships the browser-scoped version of this (the
agent drives the authenticated embedded browser via `browser_*`). **Capabilities
ride on MCP; ACP is the transport + session control plane.** That's the lens for
everything below.

---

## The unified sequence

Each phase is independently shippable and independently `/goal`-able. Workstream IDs
(`W1`–`W12`) are preserved as stable labels; the phases organize them by dependency
and value.

| Phase | What | Workstreams | Risk / tier |
|---|---|---|---|
| **1A** | Session/composer surface — renderer only | rail rename + New Session, chip rework, agent-settings popover | Renderer-only, hot-reload, low risk |
| **1B** | Plumb modes + config options + usage generically | W4, W5, W8 | Main + shared, one restart |
| **2** | Richer prompt input + command palette | W1, W6 | Renderer-leaning, low cost |
| **3** | Terminal capability | W2 | Main, medium cost, verify-first |
| **4** | Session persistence / resume / fork / list | W3, W9 | Main + UI, highest surface area |
| **opportunistic** | Elicitation | W7 | Build when a use case demands it |
| **context** | MCP path, fs broker, `_meta` options | W10, W11, W12 | Not new work; catalogued |

Rationale for the order: Phase 1A fixes visible bugs with zero restart cost and
builds the **agent-settings popover** that 1B fills. Phase 1B is the shared
main-process plumbing (modes/config/usage) that the former leverage plan's W4/W5/W8
needed anyway — build it once, generically, both backends, one path. Phases 2–4 are
purely additive and don't block each other; W1 (images) is the cheapest high-value
win and can run in parallel with Phase 1 if desired.

---

## Phase 1 — Session & composer surface

### Goal

1. Rename the rail's "New session" entry to **Home** (it already routes home — the
   label is wrong).
2. Add a real **New Session** rail button that starts a fresh session and drops you
   into chat.
3. Rework the composer's context chips: drop the **Self-edit** flag and the
   standalone **Claude** backend tag; show **workspace** and **branch**; add an
   **agent settings** control (model, permission mode, reasoning effort where the
   backend supports it).
4. Make the permission-mode control real (1B): drive runtime `setSessionMode`
   instead of the `.claude/settings.local.json` workaround, and render whatever
   modes/config options each backend advertises.
5. Surface truthful usage/cost (1B).

### Current state (grounded)

- [Rail.tsx:60](../../src/shell/Rail.tsx#L60) — `<Link to="/new">` labelled
  `New session`. `/new` is the home screen (`src/routes/new.tsx`, `HomeScreen`).
  Misnamed: it navigates home, it does not start a session.
- `src/app/sessions.ts` — `startSession(ws)` creates a session and makes it
  active; `openSession(m)` resumes one. Already used by the rail's workspace /
  recent buttons and by the home screen.
- [Composer.tsx](../../src/app/chat/Composer.tsx) — `ctx-chips` renders branch
  (hardcoded `'hearth'` default at :88, never passed by `ChatView`), a static
  Self-edit chip, and a Claude chip that opens `BackendPop` (backend switch + model
  list). The Plan/Auto/Ask `Seg` (:10) is purely local cosmetic state — `mode` is
  never sent to the agent.
- [GitPanel.tsx:42](../../src/app/workbench/GitPanel.tsx#L42) — real branch comes
  from `window.hearth.git.status(cwd).branch`; `cwd` from
  `useSession(s => s.active?.cwd)`.
- [protocol.ts:18](../../electron/shared/protocol.ts#L18) — `ModelState { available,
  current }` only. Model get/set IPC: `agentGetModels` / `agentSetModel`
  ([ipc.ts:201](../../electron/main/ipc.ts#L201)) → `agent-host.ts`. No modes,
  config options, or usage are plumbed to the renderer.

### Phase 1A — renderer only (hot-reload, low risk)

**Rail: rename + add New Session** ([Rail.tsx](../../src/shell/Rail.tsx))

- Rename the `/new` link to **Home**, icon `house` (was `plus`). Drop its kbd.
- Add a **New Session** rail item (icon `plus`) that starts a fresh session in the
  **current workspace by default** (no prompt) and routes to `/chat`:

  ```ts
  const newSession = async () => {
    const ws =
      workspaces.find((w) => w.id === useSession.getState().active?.workspaceId) ??
      workspaces.find((w) => w.isHearth) ??
      workspaces[0]
    if (!ws) return navigate({ to: '/new' }) // no workspace yet -> home to pick one
    await startSession(ws)
    useSession.getState().flashWorkspaceChip()  // see affordance below
    void navigate({ to: '/chat' })
  }
  ```

- Bind `⌘N` to **New Session**. Verify nothing else claims `⌘N`
  (`CommandPalette.tsx`, `__root.tsx`).

DECIDED: New Session targets the current workspace by default. To signal the
workspace is changeable without a modal or prompt, **briefly flash the workspace
chip** (a colored pulse) right after the session starts. Implementation: a
transient store flag (`flashWorkspaceChip()` bumps a nonce); the workspace chip
watches it and adds `.is-flashing` for ~1.5s, then removes it. CSS keyframe pulse
on `--accent`. No layout shift.

**Composer chips rework** ([Composer.tsx](../../src/app/chat/Composer.tsx))

New chip row: `[workspace] [branch] [agent settings]` (+ scratchpad chip when
attached, unchanged).

Remove:
- The static **Self-edit** chip.
- The standalone **Claude** backend chip (folds into agent settings).

**Branch chip** — wire to the real branch. Drop the `branch` prop + hardcoded
default; read `cwd` from `useSession` and fetch `window.hearth.git.status(cwd)` for
branch (+ ahead/behind), mirroring `GitPanel`. Refresh on `cwd` change and on the
`refreshDiff` nonce. Still opens `GitPanel` on click.

**Workspace chip** — show the workspace name (match `active.workspaceId` against
`window.hearth.workspaces.list()`; fall back to `basename(cwd)`). Tooltip = full
`cwd`. Carries the `.is-flashing` pulse.
- DECIDED: clicking it **switches workspace**. Opens a small popover listing
  workspaces + an "Open folder…" action (`workspaces.open()`). Picking one starts a
  new session in that workspace (`startSession(ws)`) and routes to `/chat` —
  consistent with the rail, since a session is bound to one cwd (you don't migrate a
  live session's directory).

**Agent settings chip** (icon `sliders` or `cpu`) — opens a popover that renders
whatever the active backend advertises. In Phase 1A it carries the existing
model/backend controls (so it ships value immediately); Phase 1B fills in the rest
generically:
- Backend switch (Claude / Codex) — move `BACKENDS` + `pickBackend` here.
- Model picker — existing `models.available` + `pickModel`. (For Codex, reasoning
  effort already appears here as model variants — see 1B notes.)
- Permission mode — added in 1B; renders the active backend's advertised modes and
  replaces the cosmetic Plan/Auto/Ask toggle.
- Reasoning effort — backend-dependent (1B); hide when unsupported, never fake.

### Phase 1B — modes + config options + usage (main + shared, one restart)

**What the ACP adapters actually expose (verified).** Investigated the SDK types
(`@agentclientprotocol/sdk` types.gen.d.ts) and the shipped adapter code
(`@zed-industries/claude-agent-acp@0.23.1`, `@agentclientprotocol/codex-acp@0.0.44`):

ACP has a generic, agent-advertised **session config-option** system plus **session
modes** and **usage** reporting. The SDK methods `setSessionMode` and
`setSessionConfigOption` are **stable** (only `setSessionModel` is `unstable_`).
Config options carry a semantic `category`: `"mode" | "model" | "thought_level" |
<custom>` and are either a `select` (dropdown, optionally grouped) or a `boolean`
toggle, each with id/name/description/currentValue. They're returned from
`newSession` (`{ models, modes, configOptions }`), updated via `config_option_update`
/ `current_mode_update` notifications, and set via the methods above.

**Claude adapter (0.23.1)** advertises exactly two config options + modes + usage
(verified in `dist/acp-agent.js` `buildConfigOptions` / `availableModes` /
`sessionUsage`):
- `mode` (category `mode`, select): **Default, Accept Edits, Plan Mode, Don't Ask**,
  and **Bypass Permissions** when allowed.
- `model` (category `model`, select).
- usage: accumulated input / output / cachedRead / cachedWrite / total tokens.
- **No `thought_level`.** Claude exposes no reasoning-effort knob in this version.

**Codex adapter (0.0.44)** exposes **reasoning effort** but folds it into the
**model list** rather than a separate config option (verified in `dist/index.js`
`ModelId` + `createModelState`): one model entry per
`(model × supportedReasoningEffort)`, e.g. id `gpt-5-codex[high]`, name `GPT-5 Codex
(high)`. So for Codex, reasoning effort already flows through the existing model
picker / `setModel` — no new protocol work needed.

**Recommended design: generic config-options surface (not bespoke fields).** Rather
than hardcode "model + mode + reasoning effort," plumb the adapter's advertised
`configOptions` (and `modes`) through to the renderer and render each by `category`
(icon/placement) and `type` (`select` → dropdown, `boolean` → toggle). This is
forward-compatible: reasoning effort, new toggles, a future Claude `thought_level`,
etc. appear automatically. The agent-settings popover becomes a thin renderer over
that list. This subsumes the former W4 (usage), W5 (live mode), and W8 (config
options) into one path.

**Main-process work (restarts app — batch it):**
- [acp-client.ts](../../electron/main/agents/acp-client.ts) — in `newSession`,
  capture `res.modes` and `res.configOptions` (in addition to `models`); add
  `setSessionMode` and `setSessionConfigOption` passthroughs on `AgentSession`; in
  the `Client` handler, **stop dropping** `current_mode_update` /
  `config_option_update` / `usage_update` (currently the `default:` case at
  [acp-translate.ts:168](../../electron/main/agents/acp-translate.ts#L168)).
- [acp-translate.ts](../../electron/main/agents/acp-translate.ts) — translate those
  three update kinds; add `normalizeConfigOptions` / `normalizeModes` (pure,
  unit-tested like `normalizeModels`).
- [agent.ts](../../electron/main/agents/agent.ts) +
  [protocol.ts](../../electron/shared/protocol.ts) — extend the `AgentSession`
  contract and shared types with `ConfigOption`, `ModeState`, `Usage`; new
  `SessionUpdate` variants for config/mode/usage changes.
- [agent-host.ts](../../electron/main/agents/agent-host.ts) +
  [ipc.ts](../../electron/main/ipc.ts) + preload bridge — get/set config option +
  mode IPC, plus change events (mirror the existing `onModelsChanged` pattern).

**Usage line.** Handle `usage_update`; surface per-session + cumulative token/cost in
the agent-settings popover as a read-only line, with copy that reflects the Agent-SDK
metered-credit reality ([COMPLIANCE.md](../COMPLIANCE.md)) so users aren't surprised.

### Backend parity (hard requirement)

Claude and Codex must be driven by **one code path**, no per-backend branching in the
renderer or IPC. The two advertise *different* mode sets, so parity is structural,
not label-for-label:

- Claude: `default`, `acceptEdits`, `plan`, `dontAsk`, (`bypassPermissions`).
- Codex: `read-only`, `agent`, `agent-full-access`.

Consequences:

1. **Render advertised modes generically.** The mode control shows whatever the
   active backend returned in `res.modes.availableModes` (id/name/description) — it
   does NOT map to fixed Hearth labels. The cosmetic Plan/Auto/Ask `Seg` is replaced
   by this advertised-mode selector. No translation table (the kind in `claude.ts`
   today is exactly what we're removing).
2. **DECIDED: replace the `.claude/settings.local.json` mode workaround with runtime
   `setSessionMode`.** `claude.ts ensureProjectPermissionMode` is a Claude-only
   special case with no Codex analog — removing it makes the backends symmetric. Both
   adapters implement the stable `setSessionMode`; other advertised config options
   (and any future `thought_level`) go through `setSessionConfigOption`. Same path,
   backend-supplied content.
3. **Initial mode: DECIDED — Default / prompt** (was `acceptEdits` under the
   workaround). After `newSession`, apply via `setSessionMode`: Claude → `default`,
   Codex → `agent` (on-request approval). Verify it survives reconnect / reload.
4. Reasoning effort stays asymmetric *by adapter design*: Codex exposes it as model
   variants, Claude (0.23.1) not at all. **DECIDED — leave Codex effort in the model
   list**; no separate control, no suffix parsing. A Claude `thought_level` option
   renders the moment an adapter advertises it.

### Phase 1 files touched

Renderer (hot-reload, 1A):
- [Rail.tsx](../../src/shell/Rail.tsx) — Home rename, New Session, `⌘N`, flash trigger.
- [Composer.tsx](../../src/app/chat/Composer.tsx) — chip rework, agent-settings
  popover, real branch + workspace, workspace switch popover.
- `src/app/session-store.ts` — `flashWorkspaceChip()` nonce.
- [ChatView.tsx](../../src/app/chat/ChatView.tsx) — drop the unused `branch` prop.
- `src/styles/**` — chip flash keyframe, popover styling.

Main + shared (restart, 1B): `acp-client.ts`, `acp-translate.ts`, `agent.ts`,
`agent-host.ts`, `ipc.ts`, preload bridge, `protocol.ts`.

### Phase 1 verification

- Rail: `view_app({ path: "/" })` — Home label + working New Session; clicking it
  lands in `/chat` with a fresh session and the workspace chip pulses once.
- Composer: chips are `[workspace] [branch] [agent settings]`; branch matches `git
  status`; workspace chip switches workspace; settings popover switches
  model/backend. For Codex, confirm effort variants appear in the model list.
- 1B: confirm Claude advertises Default/AcceptEdits/Plan/DontAsk in the popover and
  that selecting Plan actually puts the agent in plan mode (i.e. `setSessionMode`
  replaces the `.claude/settings.local.json` workaround). Confirm usage appears and
  ties to `usage_update` payloads, not a guess.
- `bun run typecheck` + lint + build + test; add `acp-translate` tests for the new
  normalizers.

### Phase 1 verification items (do while building, not user decisions)

- Confirm removing the `.claude/settings.local.json` write doesn't break anything
  else that reads it (e.g. a plain `claude` run in the same repo).
- Confirm the chosen default mode survives reconnect / session reload for both
  backends.
- **Don't clobber user hooks** (see Non-goals → hooks). The Claude adapter loads
  hooks from `~/.claude/settings.json`, `.claude/settings.json`, and
  `.claude/settings.local.json` (`settingSources: ["user","project","local"]`), so a
  user's `hooks` block in the local file is live under Hearth. Today
  `claude.ts ensureProjectPermissionMode` merges surgically (only sets
  `permissions.defaultMode`). When 1B removes that write, any cleanup must remove
  **only** our `permissions.defaultMode` key — never delete the file or other keys
  (hooks, env, mcpServers, etc.).

---

## Phase 2 — Richer prompt input + command palette

### W1 — Image + embedded-context prompt input
Both adapters advertise `promptCapabilities.image`; Claude also `embeddedContext`.
Hearth sends text only.
- Build: composer accepts pasted/dropped **images** (screenshots) and **file/
  resource** context; send them as ACP content blocks alongside text at the prompt
  call ([acp-client.ts:216](../../electron/main/agents/acp-client.ts#L216),
  `prompt: [{ type:'text' }]`). Gate on the advertised capability per backend
  (Codex: image yes, embeddedContext no).
- Value: the real "show the agent what's on screen" — pair with the browser's
  `browser_screenshot` for a screenshot→agent loop. High value, low cost.
- Note: W1 is self-contained at the prompt-content layer and can run in parallel
  with Phase 1.

### W6 — Slash commands / skills as a first-class palette
Hearth already captures advertised commands
([acp-client.ts:113](../../electron/main/agents/acp-client.ts#L113), exposed via
`advertisedCommands()` at [:169](../../electron/main/agents/acp-client.ts#L169)) but
doesn't surface them richly.
- Build: expose the agent's advertised commands/skills in the command palette /
  composer (e.g. `/compact`, custom skills), updating on
  `available_commands_update`. Medium value, low cost (data already flows).

---

## Phase 3 — Terminal capability (W2)

Hearth doesn't advertise `clientCapabilities.terminal`, so the agent executes
commands invisibly inside the adapter. ACP lets the agent call `terminal/create ·
output · wait_for_exit · kill · release` **on the client**.
- Build: advertise `terminal: true`; implement the handlers on top of the existing
  [TerminalManager](../../electron/main/terminal/pty.ts) so agent commands run in a
  Hearth-owned PTY — visible in the always-available terminal panel, cancellable,
  and gateable.
- Value: visibility + control + sandbox alignment (mirrors the fs-broker mediation
  lever, W11). High value, medium cost.
- **Caveat (verify first):** the fs-broker spike found the Claude adapter ignores
  the client fs capability and writes disk directly (see W11). The terminal
  capability may be ignored the same way — some adapters run their own PTY
  regardless. Before building, confirm each adapter actually routes execution through
  `terminal/*` on the client when offered; if not, W2 is inert for that backend,
  exactly like fs mediation.

---

## Phase 4 — Session persistence / resume / fork / list (W3, W9)

Both adapters advertise `loadSession` and resume/list (Claude also fork/close).
Hearth creates every session fresh and never reopens one.
- **W3** — wire `session/load`/`resume` to reopen a prior conversation with full
  context; `session/list` to enumerate; `session/fork` (Claude) to branch a
  conversation. Back Hearth's History/sessions with this instead of cold starts.
  High value, medium-high cost (touches session store + UI). Per-backend: Codex has
  no fork.
- **W9 — Session info (`session_info_update`).** Reflect agent-provided session
  title/metadata in the UI (auto-titled threads). Low value, low cost; pairs
  naturally with W3.

---

## Opportunistic

- **W7 — Structured elicitation (`session/elicitation`).** Let the agent ask the
  user a structured question mid-task (choices/inputs) instead of free-text only.
  Medium-low value; do when a use case demands it.

---

## Cross-cutting / context (not new work here)

- **W10 — MCP as the capability-extension path (incl. computer use).** The mechanism
  for adding tool families (computer use, Playwright, data, etc.) is the
  connector/MCP path in [CONNECTORS-PLAN.md](../completed-plans/CONNECTORS-PLAN.md).
  ACP carries tool calls; MCP supplies the tools.

- **W11 — fs broker mediation as a sandbox lever.** Hearth has a write broker wired
  to `clientCapabilities.fs`
  ([acp-client.ts:99-151](../../electron/main/agents/acp-client.ts#L99)), but it is
  **gated OFF by default** (`HEARTH_MEDIATE_WRITES`) and the spike found the current
  Claude adapter **ignores client fs** — it writes disk directly and only reports
  diffs, so mediation is inert with this adapter. Scope enforcement instead lives at
  the commit layer (self-mod-service). The broker is built, tested, and ready for a
  future adapter that honors client fs. W2 (Phase 3) extends the same "mediate the
  client-side capability" pattern to the terminal — see the W2 caveat.

- **W12 — Programmatic `_meta.claudeCode.options` (Claude-only).** The Claude adapter
  reads a programmatic options bag from `session/new`'s `_meta.claudeCode.options`
  ([acp-agent.js:938](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js)):
  `tools`, `disallowedTools`, `env`, `mcpServers`, `extraArgs`,
  `additionalDirectories`, `hooks`. Hearth sends **none** of it today
  ([acp-client.ts:206](../../electron/main/agents/acp-client.ts#L206),
  `newSession({ cwd, mcpServers })`). Some are genuine future levers (e.g. per-session
  `disallowedTools` gating), but the whole channel is **Claude-only via `_meta`** —
  not parity-clean. Deprioritized; `hooks` specifically is declined (see Non-goals).

---

## Non-goals

- **Acting on `authMethods` / driving auth via ACP.** Captured for display only;
  Hearth never originates or stores a subscription token
  ([COMPLIANCE.md](../COMPLIANCE.md)). Out of scope by policy, not by capability.
  (Auth methods are already surfaced in Settings → Auth; advertised commands/skills
  in Settings → Skills.)
- **Audio prompt input.** Neither adapter advertises it.
- **Reimplementing the browser or its agent control** — already built; see
  CONNECTORS-PLAN.md Track C.
- **Lifecycle hooks (PreToolUse / PostToolUse / etc.).** Researched and declined.
  ACP has no hooks concept (0 schema mentions); hooks are agent-native. Claude
  supports them two ways — settings-file hooks that **already fire** under Hearth
  (the adapter passes `settingSources: ["user","project","local"]`,
  [acp-agent.js:954](../../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js)),
  and programmatic hooks via `_meta.claudeCode.options.hooks` on `session/new` (which
  Hearth doesn't send). Codex has a separate, incompatible mechanism, so hooks are
  **not parity-clean** like modes/config-options. We're not building a hooks UI or
  sending programmatic hooks: the safety use-cases are already covered better by the
  self-mod layer (`scope-guard`, `shell-guard`, `write-broker`, `run-tracker`,
  commit-scope + diff stream), and hooks run arbitrary shell on tool events inside a
  self-modifying app — a privilege-escalation surface. **One carry-over (not a
  feature):** the user's own settings-file hooks must keep working, so Hearth's
  `.claude/settings.local.json` writes must never clobber a `hooks` block (tracked in
  Phase 1B verification items).

---

## `/goal` block — Phase 1 (session & composer surface)

```
Implement Phase 1 (1A + 1B) from docs/plan-backlog/ACP-SESSION-SURFACE-PLAN.md. That doc
has the verified ACP surface, what Hearth uses today (with file:line refs), the
per-backend advertised capabilities, and the locked decisions. Apply Phase 1 only;
do not start Phase 2/3/4 (separate goals). Don't re-derive the analysis.

## Scope (exactly this)
- 1A (renderer-only, hot-reload): rename rail "New session" -> "Home"; add a real
  New Session rail item (current workspace by default, route to /chat, flash the
  workspace chip, bind cmd-N); rework composer chips to [workspace] [branch]
  [agent settings] — drop Self-edit + standalone Claude chip; wire branch to real
  git status (drop hardcoded 'hearth'); workspace chip shows name + switches
  workspace; agent-settings popover hosts backend + model (existing IPC).
- 1B (main + shared, one restart): in acp-client newSession capture res.modes and
  res.configOptions (not just models); add setSessionMode + setSessionConfigOption
  passthroughs; stop dropping current_mode_update/config_option_update/usage_update
  (acp-translate default: case ~:168); add normalizeModes/normalizeConfigOptions
  (pure, unit-tested); extend protocol.ts with ConfigOption/ModeState/Usage + new
  SessionUpdate variants; add get/set + change-event IPC (mirror onModelsChanged).
  Render modes/config-options generically by category in the agent-settings popover;
  replace the cosmetic Plan/Auto/Ask Seg with the advertised-mode selector; add a
  read-only usage/cost line (copy reflects the Agent-SDK metered-credit reality,
  docs/COMPLIANCE.md). Remove claude.ts ensureProjectPermissionMode and drive mode
  via runtime setSessionMode; default starting mode = Default/prompt (Claude
  default, Codex agent).

## Locked decisions
- One code path for Claude + Codex; no per-backend branching in renderer or IPC.
  Render whatever modes/configOptions the backend advertises (no fixed label map).
- Codex reasoning effort stays in the model list (variants); no separate control.
- New Session targets the current workspace; workspace chip flashes to signal it's
  changeable; clicking it switches workspace.
- Removing the settings.local.json mode write must preserve user keys, ESPECIALLY a
  hooks block — only ever touch permissions.defaultMode.
- Compliance unchanged: never act on authMethods, never store subscription tokens.

## How to work
- 1A is renderer (src/**) and hot-reloads. 1B touches electron/main/agents/** +
  electron/shared/** (restart-tier per AGENTS.md) — typecheck before restart.
- Match existing patterns: extend acp-translate for the new update kinds; reuse the
  SessionUpdate type and the onModelsChanged IPC pattern; settings/controls
  primitives + tokens per AGENTS.md.

## Verify BEFORE committing
- bun run typecheck, lint, build, test pass; add acp-translate normalizer tests.
- Drive the LIVE app (view_app / read_ui / eval_js, or .hearth/bridge-url): rail
  shows Home + working New Session, fresh session lands in /chat, workspace chip
  pulses once; composer chips are [workspace][branch][agent settings]; branch
  matches git status; workspace chip switches workspace.
- 1B: Claude advertises Default/AcceptEdits/Plan/DontAsk in the popover and
  selecting Plan actually puts the agent in plan mode (setSessionMode replaces the
  settings.local.json workaround); usage line appears and ties to usage_update
  payloads; confirm Claude AND Codex behave identically through the shared path
  before removing the workaround; default mode survives reconnect/reload.

## Commits
- Focused Hearth-SelfMod commits: one for 1A, one for 1B (message naming the phase).

## Done when
- Rail + composer redesigned; permission mode is real and backend-generic; usage is
  visible and truthful; the settings.local.json workaround is gone (user hooks
  preserved). typecheck + lint + build + test clean; live app verified in both
  themes. Plan status boxes updated + an Implementation log entry appended. Restore
  the live app to a clean state when finished.
```

## `/goal` block — Phase 2 (prompt input + command palette: W1 + W6)

```
Implement Phase 2 (W1 images + embedded context, W6 commands palette) from
docs/plan-backlog/ACP-SESSION-SURFACE-PLAN.md. Don't re-derive the analysis. Do not
start Phase 3/4.

## Scope
- W1: composer accepts pasted/dropped images (and file/resource context where the
  backend advertises embeddedContext); send as ACP content blocks alongside text at
  acp-client.ts:216 (prompt: [{type:'text'}]). Gate per-backend on
  promptCapabilities (Codex: image yes, embeddedContext no).
- W6: surface the agent's advertised slash commands/skills (captured at
  acp-client.ts:113, exposed via advertisedCommands() at :169) in the composer /
  command palette, updating on available_commands_update.

## Locked decisions
- Per-backend capability gating is mandatory: never offer image/embeddedContext/
  commands a backend didn't advertise at initialize.
- ACP is transport + session control; capabilities ride on MCP. No new tool
  families here (that's the connectors path), no new heavy deps.

## Verify BEFORE committing
- bun run typecheck, lint, build, test pass.
- W1: drive the LIVE app — paste a screenshot into the composer, send, confirm the
  agent receives it (it describes the image). Confirm Codex sends image but not
  embeddedContext, and a backend lacking a capability hides the affordance.
- W6: advertised commands appear and update live; invoking one works.

## Commits
- One focused Hearth-SelfMod commit per workstream (W1, W6).

## Done when
- Images/context send (capability-gated); advertised commands usable from the UI.
- typecheck + lint + build + test clean; live app verified in both themes. Plan
  status boxes updated + Implementation log appended.
```

Phases 3 (W2 terminal) and 4 (W3/W9 sessions) warrant their own goals given their
surface area and the verify-first caveats; spec them from the phase sections above
when picked up.

---

## Implementation log

### Phase 1 — session & composer surface (done)

**1A (renderer, commit `a88e494`).** Rail: renamed the misnamed "New session" link
to **Home** (`house`); added a real **New Session** item that starts a session in
the current workspace, binds ⌘N, and flashes the workspace chip. Composer: chips are
now `[workspace] [branch] [agent settings]` — dropped the dead Self-edit + standalone
Claude chips; branch reads the real branch (+ahead/behind) from `git.status`;
workspace chip opens a switch popover. Files: `Rail.tsx`, `Composer.tsx`,
`session-store.ts` (`flashWorkspaceChip`), `hearth.css` (flash keyframe). Verified
live: branch matched `git status` (↑8), both popovers open, both themes.

**1B (main + shared, commit `12c3e7e`).** One generic path for both backends:
- `protocol.ts`: `ModeState`/`SessionMode`, `ConfigOption` (select|boolean), `Usage`
  + `mode`/`config`/`usage` SessionUpdate variants.
- `acp-translate.ts`: `normalizeModes` / `normalizeConfigOptions` (flattens grouped
  selects) + translate the three previously-dropped updates. Unit tests added.
- `acp-client.ts`: `newSession` captures `res.modes` + `res.configOptions`; `setMode`
  (stable `setSessionMode`) + `setConfigOption`.
- `agent-host.ts`: per-kind cache + change handlers; applies the **Default/prompt**
  baseline per session via runtime `setSessionMode` (Claude `default`, Codex `agent`);
  remembers preferred mode.
- `ipc.ts`/`preload`/`channels.ts`: get/set + change events (mirror `onModelsChanged`).
  Also normalized thrown adapter errors (no more `[object Object]`).
- `Composer.tsx`: agent-settings popover renders advertised modes + model + other
  config options generically + a truthful usage line (context + cost, metered-pool
  note); replaced the cosmetic Plan/Auto/Ask Seg with a live mode pill; popover opens
  downward, viewport-clamped.

  **Deviation from the plan's "remove the settings.local.json write" decision —
  required, verified.** The bundled `claude-agent-acp@0.23.1` resolves
  `permissions.defaultMode` from merged CLI settings at *every* `session/new` and
  **hard-crashes** on an unparseable value. The dev user has `defaultMode: "auto"` in
  `~/.claude/settings.json` (newer CLIs accept it; this adapter doesn't). Fully
  removing the local write exposed that latent crash (`Invalid permissions.defaultMode:
  auto.` — caught in live verification). Resolution: mode is driven at runtime as
  planned, but `claude.ts` keeps **one narrow, documented compatibility shim** —
  `ensureParseablePermissionMode` writes a parseable baseline (`default`) into local
  settings *only when the effective merged value would crash the adapter*, merged
  surgically (preserves `allow`/`hooks`/`enabledMcpjsonServers`/…). No-op when the
  user's mode is valid or absent. This honors the plan's intent (runtime-driven,
  symmetric, Default baseline, hooks preserved) without bricking session creation. A
  future adapter that tolerates its own CLI's modes lets the shim be deleted.

  Verified live (Claude, subscription): session create succeeds; modes render +
  switch live (`setMode('plan')` → mode pill updates); model switch; usage shows
  `18.3k / 1.0M context · $0.11` with the compliance note; both themes.
