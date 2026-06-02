# ACP Leverage Plan

Hearth talks to its backends over the Agent Client Protocol (ACP). The protocol
exposes far more than Hearth currently uses — session persistence, richer prompt
input, a terminal capability, usage metering, live mode control, structured
elicitation, and more. This plan catalogs **what ACP offers, what Hearth uses
today, and the concrete ways to leverage the rest**, tiered by value.

Each workstream is independently shippable and independently `/goal`-able; a
recommended sequence and a Tier-1 `/goal` block are at the bottom. Connector/MCP
leverage is covered separately in [CONNECTORS-PLAN.md](CONNECTORS-PLAN.md) and only
cross-referenced here (W10).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## How the stack actually works (verified)

- **ACP → Claude Agent SDK → Claude Code engine.** The Claude adapter
  (`@zed-industries/claude-agent-acp`) imports `query`, `listSessions`,
  `getSessionMessages` from **`@anthropic-ai/claude-agent-sdk@0.2.83`**
  ([acp-agent.js:2](../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js))
  and drives the SDK's `query()` (which bundles the Claude Code `cli.js`). It is
  **not** the interactive `claude` CLI. Codex is the analogous shape via its own
  app-server SDK. **Consequence:** subscription usage runs through the Agent SDK's
  **metered credit pool**, not the full interactive allowance — see
  [COMPLIANCE.md](COMPLIANCE.md). This makes W4 (usage metering) more than cosmetic.

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
  - Claude ([acp-agent.js:116-150](../node_modules/@zed-industries/claude-agent-acp/dist/acp-agent.js)):
    `promptCapabilities { image, embeddedContext }`, `mcpCapabilities { http, sse }`,
    `loadSession: true`, `sessionCapabilities { fork, list, resume, close }`.
  - Codex ([index.js:19893+](../node_modules/@agentclientprotocol/codex-acp/dist/index.js)):
    `promptCapabilities { image }`, `mcpCapabilities { http, sse:false }`,
    `loadSession: true`, `sessionCapabilities { resume, list }`, `auth { logout }`.

- **What Hearth uses today (verified).**
  - Declares only `clientCapabilities: { fs: { readTextFile, writeTextFile } }`
    ([acp-client.ts:151](../electron/main/agents/acp-client.ts#L151)) — **no
    terminal capability**.
  - Sends **text-only** prompts: `prompt: [{ type: 'text', text }]`
    ([acp-client.ts:216](../electron/main/agents/acp-client.ts#L216)); composer is a
    plain textarea ([Composer.tsx](../src/app/chat/Composer.tsx)).
  - Handles `agent_message_chunk · agent_thought_chunk · tool_call ·
    tool_call_update · plan · available_commands_update`
    ([acp-translate.ts:99-166](../electron/main/agents/acp-translate.ts#L99)) and
    **explicitly drops** `current_mode_update · config_option_update · usage_update`
    (translate.ts:166).
  - Uses `set_model` ([acp-client.ts:220](../electron/main/agents/acp-client.ts#L220))
    and `cancel`. **Does not** use `session/load · resume · fork · list` — every
    session is created fresh.
  - Pins permission mode by writing `.claude/settings.local.json` before connect
    ([claude.ts ensureProjectPermissionMode](../electron/main/agents/claude.ts)),
    rather than driving `set_mode` live.

---

## "Computer use" — where it fits (the framing)

Computer use is **not** an ACP capability and not a native Claude Code feature —
ACP has no screen/mouse/keyboard primitive. It's an Anthropic *model/API* tool, and
it reaches an agent as an **MCP server** (the `mcp__computer-use__*` tools are
exactly that). So "computer use through ACP" = add a computer-use MCP server via the
connector path ([CONNECTORS-PLAN.md](CONNECTORS-PLAN.md)); ACP just carries the tool
calls. Hearth already ships the browser-scoped version of this (the agent drives the
authenticated embedded browser via `browser_*`). **Capabilities ride on MCP; ACP is
the transport + session control plane.** That's the lens for everything below.

---

## Workstreams (tiered by value)

### Tier 1 — headline leverage

- **W1 — Image + embedded-context prompt input.** Both adapters advertise
  `promptCapabilities.image`; Claude also `embeddedContext`. Hearth sends text only.
  - Build: composer accepts pasted/dropped **images** (screenshots) and **file/
    resource** context; send them as ACP content blocks alongside text
    ([acp-client.ts:216](../electron/main/agents/acp-client.ts#L216)). Gate on the
    advertised capability per backend (Codex: image yes, embeddedContext no).
  - Value: this is the real "show the agent what's on screen" — pair it with the
    browser's `browser_screenshot` for a screenshot→agent loop. High value, low
    cost.

- **W2 — Terminal capability (agent runs commands through Hearth's PTY).** Hearth
  doesn't advertise `clientCapabilities.terminal`, so the agent executes commands
  invisibly inside the adapter. ACP lets the agent call `terminal/create · output ·
  wait_for_exit · kill · release` **on the client**.
  - Build: advertise `terminal: true`; implement the handlers on top of the existing
    [TerminalManager](../electron/main/terminal/pty.ts) so agent commands run in a
    Hearth-owned PTY — visible in the always-available terminal panel, cancellable,
    and gateable.
  - Value: visibility + control + sandbox alignment (mirrors the fs broker
    mediation lever, W11). High value, medium cost. Verify both adapters actually
    route execution through the client terminal when offered (some run their own).

- **W3 — Session persistence, resume, fork, list.** Both advertise `loadSession`
  and resume/list (Claude also fork/close). Hearth creates every session fresh and
  never reopens one.
  - Build: wire `session/load`/`resume` to reopen a prior conversation with full
    context; `session/list` to enumerate; `session/fork` (Claude) to branch a
    conversation. Back Hearth's History/sessions with this instead of cold starts.
  - Value: turns History into real, resumable threads + branching. High value,
    medium-high cost (touches session store + UI). Per-backend: Codex has no fork.

### Tier 2 — strong, scoped

- **W4 — Usage / cost metering (`usage_update`).** Currently dropped in translate.
  - Build: handle `usage_update`, surface tokens/cost per session and cumulatively;
    tie messaging to the Agent-SDK metered-credit reality (COMPLIANCE.md) so users
    aren't surprised. Medium-high value, low cost.

- **W5 — Live permission-mode switcher (`set_mode` + `current_mode_update`).**
  Mode is pinned via a settings file at connect; ACP supports changing it live.
  - Build: a mode control (plan / acceptEdits / default / bypass where allowed) that
    calls `session/set_mode` and reflects `current_mode_update`. Keep the safe
    default; just make it live and visible. Medium value, low-medium cost.

- **W6 — Slash commands / skills as a first-class palette
  (`available_commands_update`).** Hearth already captures advertised commands
  ([acp-client.ts:168](../electron/main/agents/acp-client.ts#L168)) but doesn't
  surface them richly.
  - Build: expose the agent's advertised commands/skills in the command palette /
    composer (e.g. `/compact`, custom skills), updating on
    `available_commands_update`. Medium value, low cost (data already flows).

### Tier 3 — opportunistic

- **W7 — Structured elicitation (`session/elicitation`).** Let the agent ask the
  user a structured question mid-task (choices/inputs) instead of free-text only.
  Medium-low value; do when a use case demands it.

- **W8 — Adapter config options (`set_config_option` + `config_option_update`).**
  Surface adapter-specific knobs the backend exposes at runtime. Low value; build
  reactively per backend.

- **W9 — Session info (`session_info_update`).** Reflect agent-provided session
  title/metadata in the UI (auto-titled threads). Low value, low cost; nice paired
  with W3.

### Cross-cutting / context

- **W10 — MCP as the capability-extension path (incl. computer use).** Not new
  work here — the mechanism for adding tool families (computer use, Playwright,
  data, etc.) is the connector/MCP path in
  [CONNECTORS-PLAN.md](CONNECTORS-PLAN.md). Listed so the ACP picture is complete:
  ACP carries tool calls; MCP supplies the tools.

- **W11 — fs broker mediation as a sandbox lever (context).** Hearth already routes
  agent fs reads/writes through a broker via `clientCapabilities.fs`
  ([acp-client.ts:99-151](../electron/main/agents/acp-client.ts#L99)). W2 extends the
  same "mediate the client-side capability" pattern to the terminal. Noted so W2 is
  built consistently with the existing model, not as a one-off.

## Non-goals

- **Acting on `authMethods` / driving auth via ACP.** Captured for display only;
  Hearth never originates or stores a subscription token (COMPLIANCE.md). Out of
  scope by policy, not by capability.
- **Audio prompt input.** Neither adapter advertises it.
- **Reimplementing the browser or its agent control** — already built; see
  CONNECTORS-PLAN.md Track C.

---

## Recommended sequence

1. **W1 (images)** — cheapest high-value win; immediately useful with the browser.
2. **W4 (usage)** — tiny, and it closes a real expectation/compliance gap.
3. **W6 (commands palette)** — data already flows; mostly UI.
4. **W2 (terminal capability)** — higher value, more care; sandbox-aligned.
5. **W3 (session resume/fork)** — highest structural payoff; most surface area.
6. **W5 (live mode), then W7–W9** as use cases arise.

Each is its own `/goal`. The block below bundles the cheap Tier-1/early wins
(W1 + W4 + W6) into one pass; W2 and W3 warrant their own goals given their surface
area.

---

## `/goal` block — early wins (W1 + W4 + W6)

```
Implement workstreams W1, W4, and W6 from docs/ACP-LEVERAGE-PLAN.md. That doc has
the verified ACP surface, what Hearth uses today (with file:line refs), and the per-
backend advertised capabilities. Apply those three; do not start W2/W3/W5 (separate
goals). Don't re-derive the analysis.

## Scope (exactly these)
- W1: composer accepts pasted/dropped images (and file/resource context where the
  backend advertises embeddedContext); send as ACP content blocks alongside text at
  the prompt call (electron/main/agents/acp-client.ts:216, prompt: [{type:'text'}]).
  Gate per-backend on promptCapabilities (Codex: image yes, embeddedContext no).
- W4: handle the usage_update session/update (currently dropped in
  acp-translate.ts:166); surface per-session + cumulative token/cost in the UI, with
  copy that reflects the Agent-SDK metered-credit reality (docs/COMPLIANCE.md).
- W6: surface the agent's advertised slash commands/skills (already captured at
  acp-client.ts:168) in the composer/command palette, updating on
  available_commands_update.

## Locked decisions
- ACP is transport + session control; capabilities ride on MCP. Do NOT add tool
  families here — that's the connectors path. No new heavy deps.
- Per-backend capability gating is mandatory: never offer image/embeddedContext/
  commands a backend didn't advertise at initialize.
- Compliance unchanged: never act on authMethods, never store subscription tokens.

## How to work
- Renderer changes (composer, usage UI, command palette) hot-reload (src/**).
  Capability negotiation + prompt content blocks + the usage_update handler touch
  electron/main/agents/** (restart-tier per AGENTS.md) — expect restarts +
  typecheck-before-restart.
- Match existing patterns: extend acp-translate.ts for the new update kind; reuse
  the SessionUpdate type; settings/controls primitives and tokens per AGENTS.md.

## Verify each workstream BEFORE committing
- bun run typecheck, lint, build, test pass.
- W1: drive the LIVE app (read .hearth/bridge-url, POST /eval, GET /snapshot, or
  computer-use) — paste a screenshot into the composer, send, confirm the agent
  receives it (e.g. it describes the image). Confirm Codex path sends image but not
  embeddedContext, and that a backend lacking a capability hides the affordance.
- W4: trigger a prompt and confirm token/cost appears and accumulates; confirm the
  number ties to usage_update payloads, not a guess.
- W6: confirm advertised commands appear and update live; invoking one works.

## Commits
- One focused Hearth-SelfMod commit per workstream (W1, W4, W6), message naming it.

## Done when
- Images/context can be sent to the agent (capability-gated per backend); usage is
  visible and truthful; advertised commands are usable from the UI.
- typecheck + lint + build + test clean; live app verified in both themes.
- docs/ACP-LEVERAGE-PLAN.md status boxes updated + an Implementation log appended
  (per workstream: what changed, files touched, verification). Restore the live app
  to a clean state when finished.
```

---

## Implementation log

_(append per workstream: what changed, files touched, verification results)_
