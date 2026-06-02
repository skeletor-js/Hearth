# Settings, Auth, MCP, Skills & Secrets — implementation plan

Status: proposed. Covers the Settings rebuild plus the four systems it depends
on: an ACP-native **auth experience**, a **secrets store**, **MCP server
management**, and **skills**. Read [COMPLIANCE.md](../COMPLIANCE.md) first — it
constrains the auth design hard.

## Why

Today's Settings page is hollow at the top and missing the controls that
matter:

- **Account → "Signed in: you@hearth.local"** and **"Keys: Bring-your-own
  keys"** are hardcoded JSX with no backing. There is no account system and no
  way to see or change auth.
- **Auth is invisible and boot-only.** [`resolveAuth`](../../electron/main/index.ts)
  picks subscription vs. api-key once at startup from env vars. The renderer
  never learns whether the agent is actually authenticated. A user with no
  `claude login` and no API key gets a silent failure at first prompt.
- **No MCP management.** Only the built-in `hearth` bridge server is injected
  (`bridgeMcpServers()` in [acp-client.ts](../../electron/main/agents/acp-client.ts)).
  Users can't add their own servers.
- **No skills surface.** Skills live in `~/.claude/skills`; the app inherits
  them but shows nothing.
- **No secrets store.** API keys are read from `process.env` only. MCP servers
  that need tokens have nowhere to get them.

The correction from the first review: **we are not an API-key product.** We
drive Claude Code and Codex over ACP; each authenticates itself. BYO API key
stays a first-class path (compliance rule 4) but it is one option, not the
model.

## Compliance guardrails (non-negotiable)

From [COMPLIANCE.md](../COMPLIANCE.md):

1. **Never render the Claude OAuth flow.** We do not build a "Sign in with
   Claude" button or host the web flow. The user runs `claude login` themselves;
   the browser OAuth happens in *their* browser. We may *surface and launch* the
   CLI command, but the credential exchange is theirs.
2. **Never store, broker, or proxy a subscription token.** The secrets store
   holds API keys (the user's own keys) and MCP env values only — never an
   inherited subscription/OAuth token.
3. **Never host the agent.** Unchanged; we already spawn locally.
4. **BYO API key is first-class.** It gets equal billing in the auth UI.

Net: the auth UX is **status + guided login**, not an OAuth integration.

---

## System 1 — Secrets store (foundation; build first)

Everything else (API keys, MCP env) needs this.

**Storage.** Electron `safeStorage` (encrypts via the OS keychain — Keychain on
macOS, DPAPI on Windows, libsecret on Linux). Encrypted blob persisted under
`app.getPath('userData')/secrets.json`. No native dep beyond what Electron
ships. Never written to the repo, never logged, never sent over IPC in
plaintext after being set.

**Module.** `electron/main/secrets/secret-store.ts`
- `set(key: string, value: string)`, `get(key)`, `delete(key)`, `list()` →
  returns key names + presence only, never values.
- Keys namespaced: `apikey.anthropic`, `apikey.openai`, `mcp.<server>.<VAR>`.

**IPC** (new channels in [ipc.ts](../../electron/main/ipc.ts), exposed in
[preload](../../electron/preload/index.ts) as `window.hearth.secrets`):
- `list()` → `{ key, hasValue }[]`
- `set(key, value)` → void
- `delete(key)` → void
- Getters live in main only. The renderer sets/clears but never reads a secret
  back — it only sees presence.

**Wiring into auth.** `resolveAuth` ([index.ts](../../electron/main/index.ts)) gains
a secrets-store check before the env-var check: a stored `apikey.anthropic` /
`apikey.openai` becomes `{ mode: 'api-key' }`, injected into the adapter env at
spawn (claude.ts / codex.ts already read `config.auth`). Env var stays as an
override for headless/CI.

---

## System 2 — Auth experience (ACP-native)

### What the ACP layer already gives us

`connection.initialize()` returns `InitializeResponse.authMethods: AuthMethod[]`
— but [acp-client.ts](../../electron/main/agents/acp-client.ts) **discards the
return value today.** Auth method kinds:
- `AuthMethodTerminal` — "client runs an interactive terminal for the user to
  authenticate via a TUI" (this is the `claude login` / `codex login` path).
- `AuthMethodEnvVar` — set an env var (API key).
- `AuthMethodAgent` — agent-driven.

The SDK also exposes `connection.authenticate({ methodId })` and a `LogoutRequest`.

### Auth state model

New type (shared/protocol.ts):
```ts
type AuthState =
  | { status: 'authenticated'; via: 'subscription' | 'api-key' }
  | { status: 'unauthenticated'; methods: AuthMethod[] }
  | { status: 'unknown' }
```

**Detection.** Capture the `initialize` response in `AcpClient.connect()` and
store `authMethods`. Treat the backend as authenticated if a prompt/newSession
succeeds; surface `unauthenticated` when the adapter reports an auth error
(stderr already streams to our log — parse for the adapter's auth-required
signal, or rely on `initialize` returning auth methods + a failing newSession).

**IPC.** `window.hearth.auth`:
- `status(kind)` → `AuthState`
- `onAuthChanged(cb)` — push updates when a login completes or backend swaps
- `login(kind)` — see below
- `logout(kind)` — calls ACP `logout` where supported; for API-key clears the
  stored secret.

### The login flows (per backend, per method)

**Subscription / terminal login (Claude, Codex).** Compliance-safe path:
1. User clicks **"Log in to Claude"** in Settings.
2. We open the existing **Terminal tab** (PTY already exists,
   [pty.ts](../../electron/main/terminal/pty.ts)) seeded with `claude login`
   (`codex login` for Codex) and focus it.
3. The user runs it; the CLI opens *their* browser for OAuth. Hearth renders
   nothing of the flow — it just hosts a real shell the user drives. Credential
   lands in `~/.claude` / OS keychain, owned by the CLI, not us.
4. On terminal exit (or a "Re-check" button), re-probe `auth.status` and update
   the badge.

   > Compliance note: hosting a shell where the user *runs the CLI themselves*
   > is materially different from us rendering the OAuth flow. We surface the
   > command and re-check status; we never capture, store, or proxy the token.
   > If we want to be maximally conservative, the button instead shows the
   > command to copy and a "Re-check" action without auto-running it. **Decision
   > needed — default to auto-seeding the Terminal tab.**

**BYO API key (both).** A masked field per backend → `secrets.set('apikey.*')`.
Status badge flips to "Authenticated · API key". Includes the June 15 2026
metered-credit-pool caveat as helper text (COMPLIANCE.md "things to keep
watching").

### Settings — Account/Auth section (replaces the two fake rows)

Per backend (Claude, Codex), one row group:
- Status badge: `● Authenticated · subscription` / `● Authenticated · API key`
  / `○ Not signed in`.
- Action: **Log in** (terminal flow) · **Use API key** (reveals masked field) ·
  **Log out**.
- Helper text on metered subscription usage.

---

## System 3 — MCP server management

### Insertion point

`AcpClient.bridgeMcpServers()` ([acp-client.ts](../../electron/main/agents/acp-client.ts))
returns the array passed to `newSession({ mcpServers })`. Today it returns just
the `hearth` bridge. We **merge user servers into that array.**

### Registry

`electron/main/mcp/registry.ts` — persisted list under `userData`. Each entry:
```ts
type McpServerConfig = {
  id: string
  name: string
  enabled: boolean
  transport:
    | { type: 'stdio'; command: string; args: string[] }
    | { type: 'http'; url: string }
    | { type: 'sse'; url: string }
  env: { name: string; secretKey?: string; value?: string }[] // secretKey → secrets store
}
```
The SDK already types `McpServerStdio | McpServerHttp | McpServerSse`. Env values
resolve from the secrets store at session-creation time (so tokens never sit in
the registry file).

### IPC — `window.hearth.mcp`

- `list()` → configs (with `hasSecret` flags, never raw secret values)
- `add(config)` / `update(id, patch)` / `remove(id)` / `setEnabled(id, on)`
- `test(id)` — spawn the server, run the ACP/MCP handshake, report
  reachable + tool count, tear down. Surfaces config errors before a real
  session depends on it.

### Settings — Connectors section

- List of servers: name, transport chip, enabled toggle, status dot, tool count.
- Add/edit drawer: name, transport + command/url, env rows (value or "from
  secret"), Test button.
- Built-in `hearth` server shown read-only ("Built in") so users see what's
  already wired.

Existing sessions don't hot-add servers (ACP binds them at `newSession`); new
sessions pick up changes. Note this in the UI ("applies to new sessions").

---

## System 4 — Skills

Lighter than MCP — skills are files in `~/.claude/skills` (global) and
`<workspace>/.claude/skills` (project), inherited because we use the user's real
config dir. The ACP stream also advertises them: `AvailableCommandsUpdate` /
`AvailableCommand` arrive via `session/update` (we currently drop these in
[acp-translate.ts](../../electron/main/agents/acp-translate.ts)).

**Scope for v1 (discovery + access, not authoring):**
- Capture `availableCommands` updates → new `SessionUpdate` variant → renderer.
- `window.hearth.skills.list()` reads skill dirs (global + workspace), returns
  name + description + scope + source path.
- Settings — Skills section: list with scope chips, "Reveal folder" action,
  link to docs on adding a skill. Enable/disable IMPLEMENTED (v2): a per-skill
  toggle moves the folder between `skills/` and `skills-disabled/` so the agent
  stops/starts seeing it (see V2-PACKAGING-PLAN.md WS3, skills/list.ts
  `setSkillEnabled`).

---

## Settings IA — the rebuilt page

Order top to bottom (replaces current [settings.tsx](../../src/routes/settings.tsx)):

1. **Account & Auth** — per-backend status + login/api-key/logout. *(replaces
   the two fake rows)*
2. **Agent** — default backend, default model, command approval. *(keep as-is)*
3. **Connectors (MCP)** — server list + add/edit/test. *(new)*
4. **Skills** — discovered skills + reveal folder. *(new)*
5. **Secrets** — flat view of stored secret *names* (api keys, mcp env), with
   delete. No values shown. *(new — the "general secrets management" surface)*
6. **Personality** — length, directness, density. *(keep)*
7. **Memory** — status + **Open file** + **Clear** actions; bounded-height
   preview with scroll instead of raw dump. *(improve)*
8. **Self-modification** — guardrail toggle (allow Hearth to edit its own
   source), link to History. Surfaces the W0b source-mutating-shell guard that
   exists but is invisible. *(new)*
9. **Data & privacy** — Reveal data folder, Clear conversation history. Backs
   the page's "stays on your machine" subtitle with real actions. *(new)*
10. **Appearance** — theme, accent, reduce motion. *(keep; moved down — it's the
    least load-bearing)*
11. **About** — version, adapter/SDK versions, links. *(new)*

Cut entirely: the static "Signed in: you@hearth.local" row and the decorative
"Bring-your-own keys" chip.

`controls.tsx` (`Seg`, `Switch`, `SetRow`, `SecLabel`) is reused throughout; add
a `Field` (masked input + action) and a `ListRow` (for MCP/skills/secrets rows)
to the same file.

---

## Phasing

Each phase is independently shippable and hot-reloads (renderer) or restarts
once (main).

- **P0 — Secrets store.** `secret-store.ts` + IPC + Settings "Secrets" section.
  Foundation; nothing user-visible depends on it yet except manual add/delete.
- **P1 — Auth status (read-only).** Capture `initialize` authMethods, add
  `auth.status` + badges. No login action yet — just truthful state. Kills the
  fake Account rows.
- **P2 — Auth actions.** API-key field (→ secrets store, P0) + terminal login
  flow (reuses PTY) + logout. Full Account & Auth section done.
- **P3 — MCP management.** Registry + merge into `bridgeMcpServers()` + IPC +
  Connectors section + Test.
- **P4 — Skills.** availableCommands capture + skills.list + Skills section.
- **P5 — Polish sections.** Self-mod toggle, Data & privacy actions, Memory
  open/clear, About, Appearance move. Mostly renderer.

## Files touched

Main:
- `electron/main/secrets/secret-store.ts` *(new)*
- `electron/main/mcp/registry.ts` *(new)*
- `electron/main/agents/acp-client.ts` — capture initialize result; merge user
  MCP servers; capture availableCommands.
- `electron/main/agents/acp-translate.ts` — availableCommands → SessionUpdate.
- `electron/main/index.ts` — `resolveAuth` consults secrets store.
- `electron/main/ipc.ts` + `electron/preload/index.ts` — new `secrets`, `auth`,
  `mcp`, `skills` namespaces.
- `electron/shared/protocol.ts` — `AuthState`, `AuthMethod` re-export, new
  SessionUpdate variant.

Renderer:
- `src/routes/settings.tsx` — full rebuild into the IA above.
- `src/app/settings/controls.tsx` — add `Field`, `ListRow`.
- Likely split sections into `src/app/settings/sections/*.tsx` as the page grows
  (it's already long; 11 sections in one file is unwieldy).

## Risks / open decisions

- **Terminal login compliance** (P2). Auto-seeding `claude login` into the PTY
  vs. show-command-and-recheck. Default to auto-seed; flag for a compliance read
  before shipping commercially.
- **Auth-failure detection.** The cleanest signal is the adapter's stderr / a
  failing newSession. Confirm the exact `claude-agent-acp` unauthenticated
  signal during P1 (the SDK has no standard "unauthenticated" push; we infer).
- **MCP changes are session-scoped**, not live — set expectation in UI.
- **safeStorage availability.** On Linux without a keyring, `safeStorage`
  encryption is weaker/absent; detect `isEncryptionAvailable()` and warn rather
  than silently storing plaintext.
- **Skills enable/disable** needs file moves; v1 is read-only discovery.

## Testing

- `secret-store` — unit tests (set/get/delete/list, presence-only listing,
  encryption-unavailable path). Mirror the existing main-process test pattern
  (`*.test.ts` alongside source).
- `mcp/registry` — unit tests for merge with the built-in bridge + secret
  resolution.
- `acp-translate` — extend existing tests for availableCommands mapping.
- Auth status — fake-agent path (`HEARTH_FAKE_AGENT`) extended to report a
  scripted AuthState for renderer dev.
- Manual: `view_app({ path: '/settings' })` after each renderer phase; live
  login round-trip on a real machine (can't verify a live model turn from inside
  Claude Code — see [acp-integration-gotchas]).
