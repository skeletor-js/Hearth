# Hearth Security & Hardening Plan

> **Status: COMPLETE (2026-06-02).** All 18 workstreams landed as focused commits.
> Full gate green: typecheck, eslint, 336 tests, and a clean production build.
> W2 and W8 were additionally verified live in the running app (token bridge,
> sandboxed renderer with a CJS preload). Two notes where implementation diverged
> from the original plan, each documented in its section below:
> - **W8** needed more than a flag flip: the ESM preload was incompatible with the
>   renderer sandbox, so the preload is now built as CommonJS.
> - **W17/W18** kept behavior the plan suggested changing, because the suggested
>   change would have opened a bypass (scope-guard case-folding) or broken the
>   renderer (dropping CSP unsafe-inline, since the packaged build also runs Vite).
>   W18 instead tightened the HMR websocket to loopback.

Remediation plan for the 17 issues from the 2026-06-02 comprehensive review.
Grouped into 4 phases by risk and dependency. Each workstream (W#) is sized to
land as one focused, independently-revertable `Hearth-SelfMod` commit.

Renderer-only changes (`src/**`) hot-reload. Anything under `electron/main/**`
or `electron/preload/**` restarts the app — flagged per item.

**Global verification gate (after every workstream):**
`bun run typecheck && bun run lint && bun test`. Phase-specific manual checks
inline. Baseline at plan time: all green, 320 tests.

---

## Phase 1 — Trust-boundary criticals

Leaks from untrusted surfaces into the trusted core. Highest value. W1 and W2
are the two most important fixes in the plan.

### W1 — Broker redirect SSRF + body caps [CRITICAL]
File: `electron/main/micro-apps/broker.ts` (main; restart)
- Add `redirect: 'manual'` to `fetchImpl(decision.target, …)` (~line 171). Treat
  3xx as a returned response: pass status + `Location` back to the frame WITHOUT
  following. Do not auto-follow even to an approved host (redirect target is
  attacker-chosen).
- Bundle the MEDIUM body-DoS fix: cap `readBody` (reject > ~5 MB with 413) and
  cap the upstream `arrayBuffer()` buffering.
- Test: fake `fetchImpl` returning `302 -> http://127.0.0.1:…`; assert no second
  fetch and the injected `Authorization` header never reaches loopback. Body-cap test.
- Risk: low.

### W2 — Authenticate the agent bridge [HIGH]
Files: `electron/main/agent-bridge.ts`, `electron/main/agents/acp-client.ts:209`,
`electron/main/agent-tools/hearth-mcp-server.mjs`, `scripts/view-app.mjs` (main; restart)
- Mint `randomBytes(32).hex` once in `startAgentBridge`. Require it as an
  `x-hearth-token` header on `/eval`, `/browser/*`, AND `/snapshot`; reject
  mismatches with 401 before any `executeJavaScript`.
- Write the token to `.hearth/bridge-token` mode `0o600`; `chmod` `bridge-url` `0o600`.
- Thread to consumers: inject `HEARTH_BRIDGE_TOKEN` alongside `HEARTH_BRIDGE_URL`
  in `acp-client.ts` (MCP child env); `hearth-mcp-server.mjs` sends the header;
  `view-app.mjs` reads sibling `bridge-token` file and sends the header.
- Test: 401-without-token path (refactor handler to a pure fn taking headers).
  Manual: snapshot script + an MCP `eval_js` both still work.
- Risk: medium — four files must stay in sync. Land + smoke-test in one commit.

### W3 — Validate renderer-supplied `cwd` [HIGH]
Files: `electron/main/ipc.ts` (fs/git/terminal/skills handlers),
`electron/main/workspaces/registry.ts` (main; restart)
- Add `WorkspaceRegistry.contains(path)`: prefix-match `path` against each
  registered `workspace.path` (allows a cwd inside a workspace). Registry already
  holds every legitimate cwd (a workspace sets the session cwd), so no new
  registration flow is needed.
- Replace `at(cwd) = cwd || repoRoot` and bare `cwd || repoRoot` in
  `fsList/fsRead/fsWrite` (343), git ops (270-281), `terminalCreate` (320), and
  `skillsSetEnabled` path (458) with a guard that rejects any cwd/path not
  contained by a registered workspace; default to `repoRoot`.
- Test: registered path passes, `/Users/x/.zshrc` rejected, `..` rejected.
- Risk: low (dependency resolved — registry is the source of truth).

### W4 — Micro-app name validation [HIGH]
Files: `electron/main/ipc.ts:497-518`, `electron/main/micro-apps/server.ts`,
`electron/main/micro-apps/capabilities.ts` (main; restart)
- Export `NAME_RE` from `scaffold.ts` (or new `micro-apps/validate.ts`). Apply at
  the top of `startMicroApp`/`capabilities`/`approve`/`revoke`.
- Belt-and-suspenders: in `microAppDir`/`readManifest`, assert
  `resolve(dir).startsWith(appsDir + sep)`.
- Test: traversal cases (`../../x`) -> rejection.
- Risk: low.

### W5 — Browser scheme allowlist [HIGH]
File: `electron/main/browser/browser-view.ts` (main; restart)
- `normalizeUrl`: allow only `http:`/`https:`/`about:`; reject `file:`,
  `javascript:`, `chrome:`, etc. Apply in `navigate` and in
  `setWindowOpenHandler` before `loadURL`. Optionally add `will-navigate`.
- Test: `normalizeUrl` rejects `file:///…` and bare `javascript:`.
- Risk: low.

---

## Phase 2 — Resilience and process hygiene

### W6 — Boot auto-revert survives a dirty tree [MEDIUM — brick-recovery path]
Files: `electron/main/index.ts:88-99`, `electron/main/self-mod/git.ts` (main; restart)
- Before `revertCommit` in the watchdog path, force a clean tree
  (`git reset --hard HEAD`) so `git revert` can't fail on uncommitted changes.
- Stop swallowing the revert failure (`catch {}`) — log it and surface to the
  crash/safe-mode surface so a failed recovery is visible.
- Test: simulate dirty-tree + bad-commit; assert revert succeeds and failure reports.
- Risk: medium-high — this IS the recovery path. Test hard; verify on a real boot
  via History revert before trusting it.

### W7 — Scrub secrets from PTY env [MEDIUM]
File: `electron/main/terminal/pty.ts:34` (main; restart)
- Reuse `buildChildEnv({ scrubInheritedKeys: true })` from `child-env.ts` as the
  PTY base instead of `{ ...env }`. Keep `PATH: loginPath()`.
- Test: parent has `ANTHROPIC_API_KEY` -> absent in child.
- Risk: low (login shell re-sources profile; only injected creds dropped).

### W8 — Enable the renderer sandbox [MEDIUM]
Files: `electron/main/window.ts:12`, `electron/main/windows/overlay-window.ts:128` (main; restart)
- Flip `sandbox: false -> true` on main, snapshot, overlay windows. Preload uses
  no Node APIs, so it should load fine sandboxed.
- Test: MANUAL — launch, confirm `window.hearth` IPC works end-to-end (prompt,
  open a terminal). Only verification that matters.
- Risk: medium — do this AFTER W6 so the boot-recovery net is hardened first.

### W9 — Adapter process lifecycle [MEDIUM]
File: `electron/main/agents/acp-client.ts:318` (main; restart)
- Add `child.on('exit', …)` to null `connection`/`child` and notify `AgentHost`.
- `dispose()`: SIGTERM, then a short timer to `SIGKILL` if alive; spawn
  `detached` and kill by process-group so grandchild MCP servers die too.
- Test: exit handler clears state; manual: switch backends, confirm no orphans.
- Risk: low-medium.

### W10 — Scope `replaying` to the resumed session [MEDIUM, latent]
File: `electron/main/agents/acp-client.ts:71` (main; restart)
- Replace the global boolean with a `Set<sessionId>` (or single replaying id);
  only drop `CHAT_CONTENT_UPDATES` when `params.sessionId` matches.
- Test: a non-replaying session's updates pass through during another's replay.
- Risk: low.

### W11 — Self-mod `git mv` rename escape [MEDIUM, narrow]
File: `electron/main/self-mod/git.ts:48` (`listDirty`) + `captureTurn` scope check (main; restart)
- For a rename porcelain record, classify the consumed OLD path too; if either
  side is non-canvas (protected island), reject the rename.
- Test: `git mv <protected> <canvas>` -> rejection + restore.
- Risk: low.

---

## Phase 3 — Renderer correctness (hot-reload, low risk)

### W12 — BrowserTab stale `editing` closure [HIGH for UX]
File: `src/app/workbench/BrowserTab.tsx:32` (renderer; hot-reload)
- Move `editing` to a `useRef`, set in `onFocus`/`onBlur`, read `editingRef.current`
  in `onState` so navigation updates stop overwriting the URL bar mid-type.
- Test: manual — focus URL bar while a page loads, confirm no tug-of-war.

### W13 — Impure `id()` in `setMsgs` updater [MEDIUM]
File: `src/app/chat/ChatView.tsx:87` (renderer; hot-reload)
- Allocate new message ids BEFORE calling `setMsgs` and pass them in (StrictMode/
  concurrent-safe). Apply to `apply`, `withHearthTail`, `pushUser`.
- Fold in replay guard: during replay, don't auto-spawn the empty hearth tail in
  `pushUser` (or collapse trailing empty hearth blocks on render).
- Test: resume a session, confirm no stray empty "Hearth" bubble.

---

## Phase 4 — Cleanup and lower-priority

### W14 — Retire the write-broker for real [LOW]
Delete the `createWriteBroker` import + `HEARTH_MEDIATE_WRITES` branch in
`acp-client.ts:116`; remove `write-broker.ts` + its test. Dead, and a
scope-bypass surface if ever enabled. (main; restart)

### W15 — Tighten `shell-guard` [LOW]
`electron/main/self-mod/shell-guard.ts`: fix the `REDIRECT` regex (`>>`,
no-space, fd-qualified) and comment that interpreter writes (`node -e`/`python -c`)
are intentionally out of scope, caught by the commit filter. (main; restart)

### W16 — MCP probe error responses [LOW]
`electron/main/mcp/probe.ts:79`: branch on `msg.id` with `msg.error` -> finish
with the server's error instead of hanging to the 8s timeout. (main; restart)

### W17 — Misc LOW
- `src/app/history/History.tsx:46`: use `() => { load() }` (non-cleanup return).
- `electron/main/self-mod/scope-guard.ts:86`: stop folding case into the canonical
  path (or detect FS case-sensitivity).
- `electron/main/index.ts:215`: comment that `confirmReady` clears the watchdog
  marker on first paint (crash-on-startup coverage only).

### W18 — CSP `unsafe-inline` [MEDIUM, deferred]
`electron/main/micro-apps/session-policy.ts:54`: gate a tightened
`script-src 'self'` (+ nonce/hash) and scoped `connect-src`/`ws:` behind
`app.isPackaged`, keeping the loose dev policy. Defer to a packaged-build pass. (main; restart)

---

## Sequencing notes

- Land W6 (boot recovery) BEFORE W8 (sandbox flip) — W8 is most likely to break
  boot; harden the recovery net first.
- Phase 3 is safe anytime (hot-reload, easy revert) — good warm-up / parallel track.
- ~18 commits total. Phase 1 (~5 commits) resolves every CRITICAL/HIGH security
  finding; it's the high-value minimal cut.

## Resolved open questions

- W3: no session-start registration needed — `WorkspaceRegistry` already holds
  every legitimate cwd. Add `contains(path)` and validate against `list()`.
- W2: require the token on all bridge endpoints including `/snapshot`.
  `view-app.mjs` already reads `.hearth/bridge-url`, so reading a sibling
  `bridge-token` is zero friction.
