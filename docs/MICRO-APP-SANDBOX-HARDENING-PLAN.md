# Micro-App Sandbox Hardening Plan

Harden the isolation around **micro-apps** — agent-authored standalone Vite/React
projects under `micro-apps/<name>`, embedded in the shell via a sandboxed
`<iframe>` ([MicroAppFrame.tsx](../src/shell/MicroAppFrame.tsx)). Today the only
isolation wall is the iframe `sandbox` attribute. This plan adds the
defense-in-depth layers that attribute does **not** provide: network egress
control, session-level permission denial, real CSP headers, main-window
navigation guards, and build-time RCE containment.

Micro-app code is written by Hearth's own agent, which means it is **untrusted by
construction** — a prompt-injected or buggy turn can emit a micro-app that
exfiltrates secrets or escapes the frame. The sandbox attribute alone does not
stop that.

### Threat model & central tension (decided)

- **Adversary: a malicious micro-app.** Assume agent-authored micro-app code is
  actively hostile (prompt injection, data exfiltration, frame escape, install-
  time RCE). Every default is deny; capabilities are granted, never assumed.
- **But micro-apps must be able to reach external services.** A user may legit-
  imately want a micro-app that connects to, e.g., Google Workspace to manage
  their inbox. So a blanket "no outbound network" default is **off the table**.
- **Resolution — user-approved, per-app capability grants.** The agent may
  *propose* which external hosts/capabilities a micro-app needs; the **user**
  approves them; approval (not the agent's say-so) is what widens that app's CSP
  `connect-src`. A hostile app cannot silently add an exfiltration host because
  it cannot self-approve.
- **Corollary — secrets never enter the frame.** A micro-app that "connects to
  Google" must not hold the raw OAuth token (a hostile frame would exfiltrate
  it). Credentialed calls go through a **main-process broker** that injects auth
  server-side; the frame only ever talks to the broker endpoint. See W6.
- **Packaged builds use the same model** as dev: a per-app Vite server +
  `bun install` at runtime. So W4 (install-time RCE) is **production-critical**,
  not a dev-only concern.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Grounding (current state — verified)

All references checked against the working tree at time of writing.

- **The iframe** ([MicroAppFrame.tsx:51](../src/shell/MicroAppFrame.tsx#L51)):
  `sandbox="allow-scripts allow-same-origin"`, `referrerPolicy="no-referrer"`,
  no `allow` attribute. `src` is a per-app Vite dev URL on
  `http://localhost:<port>` returned by `microApps.start`.
- **Micro-app server** ([server.ts](../electron/main/micro-apps/server.ts)): one
  `vite` child process per app, spawned from the app's own `node_modules/.bin/vite`.
  First start runs **`bun install`** in the app dir
  ([server.ts:44](../electron/main/micro-apps/server.ts#L44)) — against an
  agent-authored `package.json`.
- **Scaffold** ([scaffold.ts](../electron/main/micro-apps/scaffold.ts)): copies
  `templates/micro-app` → `micro-apps/<name>`. Template `index.html` ships **no
  CSP**.
- **Parent CSP** ([index.html:8](../index.html#L8)): a `<meta>` tag only.
  `connect-src 'self' ws: http://localhost:* http://127.0.0.1:*`,
  `frame-src http://localhost:* http://127.0.0.1:*`. No CSP delivered as an HTTP
  header; no `frame-ancestors`.
- **Main window** ([window.ts:5-16](../electron/main/window.ts#L5)):
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (preload
  needs Node). **No `setWindowOpenHandler`, no `will-navigate` guard** — confirmed
  absent in [window.ts](../electron/main/window.ts) and
  [index.ts](../electron/main/index.ts).
- **No session permission handler:** `session.defaultSession` has no
  `setPermissionRequestHandler` / `setPermissionCheckHandler` anywhere in
  `electron/main/**`.
- **Preload bridge** ([preload/index.ts:226](../electron/preload/index.ts#L226)):
  exposes the full `window.hearth` IPC surface (agent.prompt, fs.write, secrets,
  git, terminal, selfMod, …) on the shell's main world. The micro-app iframe is a
  separate document on a different origin and does **not** receive this bridge —
  but the shell that frames it does.
- **Reference implementation already in repo:** the in-app browser
  ([browser-view.ts:57-82](../electron/main/browser/browser-view.ts#L57)) already
  does `sandbox: true` + `setWindowOpenHandler({ action: 'deny' })`. The main
  window and micro-app frame do not match this bar.
- **W1 prerequisite already satisfied (verified):** the only existing micro-app
  (`micro-apps/demo`) and `templates/micro-app` use **no** `localStorage` /
  `sessionStorage` / `indexedDB` / `document.cookie`. Dropping `allow-same-origin`
  is therefore safe with no storage migration.

### Why the sandbox attribute is not enough

1. **`allow-same-origin` + `allow-scripts` is the documented escape combo.** It
   fails to be a full escape *today* only because the micro-app happens to run on
   a different port (`:5173` vs the app's port), making it cross-origin. That is
   port-allocation luck, not a guarantee. Micro-apps do not need
   `allow-same-origin`.
2. **The sandbox attribute says nothing about network egress.** Inside the frame,
   `fetch()` / `<script src>` to any host is unrestricted because the *framed*
   document has no CSP. This is the real exfiltration path and the attribute does
   not touch it.
3. **Meta-tag CSP can't set `frame-ancestors` and is weaker on packaged
   `file://` builds.** It must also be delivered as a header.

---

## Goals

- A micro-app reaches **only** the external hosts a **user** has explicitly
  approved for it; default is same-origin (plus the broker). The agent can
  propose hosts but cannot self-grant them.
- A micro-app never holds raw secrets/OAuth tokens; credentialed external calls
  are brokered in the main process.
- A micro-app cannot escape the frame, top-navigate the shell, spawn windows, or
  obtain device permissions (camera/mic/geo/notifications).
- The shell (main window) cannot be navigated away from the app or open arbitrary
  child windows, even if the renderer is compromised.
- CSP is enforced via HTTP headers, not just a meta tag, and covers packaged
  builds.
- Installing/serving a micro-app cannot run arbitrary code in the main process at
  install time — in **dev and packaged** builds alike.

## Non-goals

- Sandboxing the agent's edits to the **shell renderer** (`src/**`) — that is
  covered by [SELF-MOD-HARDENING-PLAN.md](SELF-MOD-HARDENING-PLAN.md).
- Full OS-level sandboxing of the Vite/Node build child (separate uid, seatbelt
  profile). Flagged as a follow-up, not in scope here.
- Deep request inspection / content filtering on brokered calls. The broker
  injects credentials and enforces the host allowlist; it does not parse payloads.

---

## Workstreams

Tiered by cost/value. **W1 and W4 are the highest actual-risk must-fixes**
(malicious-agent model). **W6 is the load-bearing new design** — it is what makes
"users can connect micro-apps to external services" safe; without it, egress is
either fully closed (breaks the use case) or fully open (defeats the model). W1–W5
are mostly file-disjoint; W6 depends on W1 (it widens the per-app CSP W1
establishes). See Sequencing.

### W1 — Iframe attribute + framed-document CSP  *(cheap, high value)* — DONE

- `[x]` Dropped `allow-same-origin`; iframe is now `sandbox="allow-scripts"` with
  `allow=""` ([MicroAppFrame.tsx](../src/shell/MicroAppFrame.tsx)). The frame keeps
  an opaque origin and gets no powerful features.
- `[x]` Added the framed-document CSP floor to
  [templates/micro-app/index.html](../templates/micro-app/index.html) and the
  existing [micro-apps/demo/index.html](../micro-apps/demo/index.html). It covers
  script/style/img/font/object/base; `connect-src`/`default-src` are deliberately
  **omitted** so they can't intersect away a W6 grant — egress is governed by the
  Hearth-injected per-app header (W6), not the agent-controlled meta/Vite.
- **Verification:** unit tests assert the ungranted CSP floor
  ([session-policy.test.ts](../electron/main/micro-apps/session-policy.test.ts)).
  Live frame render is environment-gated here (offscreen snapshot window doesn't
  paint without a display — same caveat as BUILD-PLAN P4-2).

### W2 — Session-level permission denial  *(defense in depth)* — DONE

- `[x]` `installSessionPolicy()` sets `setPermissionRequestHandler` →
  `callback(false)` and `setPermissionCheckHandler` → `false` on
  `session.defaultSession`, wired in
  [index.ts](../electron/main/index.ts) bootstrap.
- **Files:** [session-policy.ts](../electron/main/micro-apps/session-policy.ts),
  [index.ts](../electron/main/index.ts).
- **Acceptance:** every powerful-feature request is denied without a prompt (deny
  is unconditional in the handlers). App boots clean with the handlers installed.

### W3 — CSP as an enforced header — DONE

- `[x]` `onHeadersReceived` on `session.defaultSession` stamps the authoritative
  CSP: `buildShellCsp()` (with `frame-ancestors 'none'`) on shell-origin
  responses, and the per-app `buildMicroAppCsp()` on micro-app-origin responses.
  Any upstream CSP is stripped first so ours wins
  ([session-policy.ts](../electron/main/micro-apps/session-policy.ts)).
- `[x]` Tightened the shell `connect-src` to `'self' ws:` in both the header
  builder and the meta ([index.html](../index.html)); blanket `localhost:*` now
  lives only in `frame-src` (where micro-app frames actually need it). `ws:` is
  retained because the packaged self-evolving build also runs Vite HMR.
- **Files:** [session-policy.ts](../electron/main/micro-apps/session-policy.ts),
  [index.html](../index.html).
- **Acceptance:** CSP builders unit-tested; header path runs for every defaultSession
  response (dev + packaged Vite-server model both serve over http). App boots clean.

### W4 — Build/install RCE containment  *(highest actual risk — prod-critical)*

Packaged builds use the same Vite-server + `bun install`-at-runtime model
(decided), so this ships in production, not just dev.

- `[x]` `installDeps` now runs `bun install --ignore-scripts`
  ([server.ts](../electron/main/micro-apps/server.ts)), so an agent-authored
  `package.json`'s lifecycle scripts can't execute in the main process. Vite +
  React need no install scripts.
- `[x]` Vite plugins / build code still run in-process — documented in Residual
  limitations as the larger follow-up (constrained child process).
- **Files:** [server.ts](../electron/main/micro-apps/server.ts).
- **Acceptance:** **verified** — a hermetic test installs a package whose
  `postinstall` writes a sentinel and asserts the sentinel is never created
  ([server.test.ts](../electron/main/micro-apps/server.test.ts)). Applies to both
  dev and packaged (same code path).

### W5 — Main-window navigation guards — DONE

- `[x]` `applyNavigationGuards()` sets `setWindowOpenHandler` → **deny outright**
  (no `shell.openExternal` — auto-opening arbitrary URLs in the user's real
  browser is itself an abuse vector under this threat model) and a `will-navigate`
  handler that blocks any top-frame navigation off the shell origin
  ([window.ts](../electron/main/window.ts)).
- `[x]` Applied to **both** the main window and the snapshot window (the latter
  was a listed follow-up — closed here since it's the same call).
- **Files:** [window.ts](../electron/main/window.ts).
- **Acceptance:** guards are unconditional (window.open denied; off-origin nav
  prevented); the renderer's own client-side routing is unaffected (SPA route
  changes don't fire `will-navigate`). App boots clean with guards installed.

### W6 — Per-app egress capability grants  *(the load-bearing new design)*

This is what makes "connect a micro-app to Google Workspace" safe under a
malicious-agent model. The agent *proposes* hosts; the **user** approves; approval
widens that one app's `connect-src`. No grant → same-origin only (W1 floor). — DONE

- `[x]` Per-app manifest `micro-apps/<name>/hearth.app.json`
  (`{ hosts: [{ host, reason }] }`), read + validated by `readManifest()`. Hosts
  are normalized to exact https origins (no http, no paths, no wildcards, no
  loopback, no IP literals) — `normalizeHost()` in
  [capabilities.ts](../electron/main/micro-apps/capabilities.ts).
- `[x]` Approval surface in [MicroAppFrame.tsx](../src/shell/MicroAppFrame.tsx):
  before launch it shows pending hosts + reasons; "Approve all & launch" or
  "Launch without access". The approved set lives in `CapabilityStore`
  (`capabilities.json` under userData) — the **source of truth**, not the
  agent-editable manifest. A manifest change just re-surfaces the host as pending.
- `[x]` Enforcement point: **Hearth's session** (`onHeadersReceived`, W3), not the
  micro-app's untrusted Vite. `buildMicroAppCsp()` derives `connect-src` from the
  approved set (+ the app's own HMR socket + the broker origin). This is the
  robust choice — a hostile app can't strip a header Hearth sets.
- **Files:** [capabilities.ts](../electron/main/micro-apps/capabilities.ts),
  [session-policy.ts](../electron/main/micro-apps/session-policy.ts),
  [MicroAppFrame.tsx](../src/shell/MicroAppFrame.tsx), IPC in
  [ipc.ts](../electron/main/ipc.ts) + [preload](../electron/preload/index.ts) +
  [channels.ts](../electron/shared/channels.ts).
- **Acceptance:** **verified by unit tests** — fresh app has no approved hosts;
  approve scopes per-app (a second app gets nothing); invalid hosts rejected;
  `capabilities()` splits approved vs pending so a manifest-only addition stays
  pending until re-approved; CSP builder adds only approved hosts
  ([capabilities.test.ts](../electron/main/micro-apps/capabilities.test.ts),
  [session-policy.test.ts](../electron/main/micro-apps/session-policy.test.ts)).

### W7 — Credential broker (secrets never enter the frame)

A hostile frame must never hold a raw OAuth token. Credentialed external calls are
proxied by the main process, which injects auth server-side. — DONE

- `[x]` Loopback broker ([broker.ts](../electron/main/micro-apps/broker.ts)) on a
  random `127.0.0.1` port. The frame calls `POST <broker>/proxy` with an
  unguessable per-app token (handed in via iframe URL query params; a template
  helper [hearth.ts](../templates/micro-app/src/hearth.ts) wraps this as
  `hearthFetch`). The broker validates token → app, enforces the W6 host
  allowlist, injects the credential from [SecretStore](../electron/main/secrets)
  server-side (`microapp.<origin>` → `Authorization: Bearer …`), and forwards.
- `[x]` Tokens are per-app (`tokenFor(name)`), random 32-byte, stable per app, and
  mapped token → app in main; the secret never crosses into the frame.
- `[x]` OAuth linking: the user stores the service credential via the existing
  encrypted secrets store; the broker reads it. The full interactive OAuth dance
  is reused-from-main and noted as a future enhancement (richer auth schemes).
- **Files:** [broker.ts](../electron/main/micro-apps/broker.ts), wired in
  [index.ts](../electron/main/index.ts), token threaded through
  [ipc.ts](../electron/main/ipc.ts) `microAppStart`.
- **Acceptance:** **verified** by an end-to-end test over a real loopback server
  with injected `fetch`: an approved-host call carries the injected `Authorization`
  header, the secret never appears in the broker's response to the frame, a
  non-approved host is 403, a forged token is 401, per-app tokens are distinct,
  CORS preflight is answered ([broker.test.ts](../electron/main/micro-apps/broker.test.ts)).

---

## Verification — status

Automated suite green after all workstreams: **`bun run typecheck` 0, `bun run
lint` 0, `bun test` 298 pass / 0 fail (+39 new), `bun run build` 0**, and the app
**boots clean** with the session policy + broker installed (no errors in the boot
log). New tests live in `electron/main/micro-apps/{capabilities,broker,session-policy,server}.test.ts`.

What each end-to-end check maps to:

1. **No install-time RCE (W4):** ✅ verified — postinstall-sentinel test leaves no
   sentinel.
2. **Secrets stay out of the frame + allowlist/token isolation (W7):** ✅ verified —
   end-to-end broker test over a real loopback server.
3. **Granted egress is scoped; manifest edits don't auto-widen (W6):** ✅ verified —
   capability-store + CSP-builder tests.
4. **Default egress closed / permission deny (W1/W2):** ✅ verified at the logic
   layer (CSP-floor + deny handlers are unconditional).
5. **No frame escape / no shell nav (W5):** ✅ logic verified (guards
   unconditional); boots clean with guards installed.
6. **Live in-window visual check** (frame render + a real cross-origin `fetch`
   blocked in the running app): ⏳ **environment-gated here** — the `hearth` MCP
   isn't connected this session and the offscreen snapshot window doesn't paint
   without a display (it returns an identical blank frame for every route). Same
   class of caveat as BUILD-PLAN P4-2. Run on a normal desktop session to close.

---

## Residual limitations — what's truly left after this

- **Vite plugins / build code still run in the main process.** W4 closes
  postinstall, not the broader "the build step runs agent code" problem. The
  honest fix is serving micro-apps from a constrained child process (separate
  uid / macOS seatbelt profile). Out of scope; tracked as a follow-up.
- **Shared loopback surface.** The micro-app Vite server binds to localhost and
  is reachable by any local process. Acceptable for a single-user desktop app;
  noted, not addressed.
- **Egress grants are host-level, not request-level.** Once a user approves a
  host for an app, the app may make *any* request to that host. The broker (W7)
  scopes to the host allowlist but does not inspect payloads (a non-goal).
- **User approval is the trust anchor.** A user who blindly approves every host a
  malicious app requests defeats W6. The approval surface should make the host +
  reason legible; it cannot prevent careless approval.

---

## Sequencing — as built

All seven workstreams landed in one pass. The CSP enforcement was unified: rather
than the micro-app's (untrusted) Vite emitting headers, Hearth's own session
injects the authoritative per-app CSP (`session-policy.ts`), which let W3 and W6
share one mechanism. W7 was built alongside W6 (it reuses the same approved-host
allowlist) instead of being deferred to a second milestone.

## Follow-ups (out of scope)

- **Constrained child process for micro-app build/serve** — the real RCE fix
  beyond W4 (Vite plugins still run in the main process). Largest remaining item.
- **Request-level (not just host-level) policy** on brokered calls.
- **Full interactive OAuth linking flow** for broker credentials (today the user
  stores the service token via the existing secrets store; the broker injects it).
- **Live in-window verification** of the egress block and approval flow on a
  desktop session with the `hearth` MCP connected (see Verification #6).
