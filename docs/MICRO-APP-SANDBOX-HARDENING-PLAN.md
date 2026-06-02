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

### W1 — Iframe attribute + framed-document CSP  *(cheap, high value)*

- `[ ]` Drop `allow-same-origin` from the iframe
  ([MicroAppFrame.tsx:51](../src/shell/MicroAppFrame.tsx#L51)); keep
  `allow-scripts` only. Prerequisite already verified clear (no storage use in
  `demo`/template — see Grounding), so no migration needed.
- `[ ]` Add explicit `allow=""` (empty) to the iframe to deny all powerful
  features regardless of the session permission handler.
- `[ ]` Add a strict **default** CSP to the micro-app template
  ([templates/micro-app/index.html](../templates/micro-app)): `default-src 'self'`,
  `script-src 'self'`, `connect-src 'self'`. This is the *floor* — a fresh
  micro-app reaches nothing external. W6 is how an app's `connect-src` gets
  widened (per-app, user-approved), so design the template CSP to be overridable
  per-app rather than hard-coded.
- **Files:** [MicroAppFrame.tsx](../src/shell/MicroAppFrame.tsx),
  `templates/micro-app/index.html`.
- **Acceptance:** existing micro-app still renders via
  `view_app({ path: "/micro/<name>" })`; with no grant, a cross-origin `fetch()`
  inside the frame is blocked by CSP; the frame cannot read `window.top`.

### W2 — Session-level permission denial  *(defense in depth)*

- `[ ]` On `session.defaultSession` in main bootstrap, add
  `setPermissionRequestHandler` and `setPermissionCheckHandler` that **deny by
  default**, allowlisting only what Hearth genuinely needs (currently: nothing
  for micro-apps).
- **Files:** [index.ts](../electron/main/index.ts) bootstrap (or a small
  `electron/main/security/session-policy.ts`).
- **Acceptance:** a micro-app calling `navigator.mediaDevices.getUserMedia` /
  `geolocation` / `Notification.requestPermission` is denied without a prompt.

### W3 — CSP as an enforced header

- `[ ]` Add `session.defaultSession.webRequest.onHeadersReceived` to inject CSP
  for the shell document, including `frame-ancestors 'none'`, so the policy holds
  on packaged `file://` builds where the meta tag is weaker. Keep the meta tag
  ([index.html:8](../index.html#L8)) as belt-and-suspenders.
- `[ ]` Tighten the parent `connect-src`: replace blanket `http://localhost:*`
  with the actual dev-server port(s); gate `ws:` to dev builds only.
- **Files:** [index.ts](../electron/main/index.ts) /
  `session-policy.ts`, [index.html](../index.html).
- **Acceptance:** response carries a `Content-Security-Policy` header in both dev
  and packaged builds; shell still loads; HMR websocket still connects in dev.

### W4 — Build/install RCE containment  *(highest actual risk — prod-critical)*

Packaged builds use the same Vite-server + `bun install`-at-runtime model
(decided), so this ships in production, not just dev.

- `[ ]` Run `bun install` with lifecycle scripts disabled (e.g.
  `--ignore-scripts` or equivalent) in
  [server.ts:44](../electron/main/micro-apps/server.ts#L44), so an
  agent-authored `package.json` cannot execute postinstall code in the main
  process. Verify micro-app deps still function without their install scripts; if
  any genuinely needs one, pin a vetted dependency set instead.
- `[ ]` Document that Vite plugins in a micro-app also run in-process at
  serve/build time; note the longer-term fix (constrained child process) as a
  follow-up.
- **Files:** [server.ts](../electron/main/micro-apps/server.ts).
- **Acceptance:** a micro-app whose `package.json` declares a postinstall that
  writes a sentinel file does **not** create that file on `microApps.start`, in
  both dev and a packaged build; the app still installs and serves.

### W5 — Main-window navigation guards

- `[ ]` Add `setWindowOpenHandler` → `deny` (or route into the in-app
  browser-view, matching [browser-view.ts:75](../electron/main/browser/browser-view.ts#L75))
  on the main window.
- `[ ]` Add a `will-navigate` handler that blocks top-frame navigation away from
  the app origin.
- **Files:** [window.ts](../electron/main/window.ts).
- **Acceptance:** `window.open('https://example.com')` from the renderer console
  opens no OS window; attempting to set `window.location` to an external URL is
  blocked; the app's own routing still works.

### W6 — Per-app egress capability grants  *(the load-bearing new design)*

This is what makes "connect a micro-app to Google Workspace" safe under a
malicious-agent model. The agent *proposes* hosts; the **user** approves; approval
widens that one app's `connect-src`. No grant → same-origin only (W1 floor).

- `[ ]` Define a per-app **capability manifest** (e.g.
  `micro-apps/<name>/hearth.app.json`) listing requested external hosts/origins
  and a human-readable reason per host. The agent writes the *request*; it is
  inert until approved.
- `[ ]` Add an **approval surface** in the shell: when an app requests hosts not
  yet approved, the user sees the host list + reasons and approves/denies. Store
  the approved set as the source of truth (not the manifest the agent can edit).
  Re-prompt when the requested set changes.
- `[ ]` Drive the micro-app's CSP `connect-src` (and the parent `frame-src` /
  any broker route) from the **approved** set, not the manifest. Wire this into
  the W1 per-app-overridable CSP and the W3 header injection.
- `[ ]` Decide enforcement point: cleanest is for the micro-app's Vite server (or
  a small wrapper) to emit the per-app CSP header from the approved set on every
  response, so the policy travels with the framed document.
- **Files:** new `electron/main/micro-apps/capabilities.ts` (+ store), approval UI
  in `src/app/**` or `src/shell/**`, manifest read in
  [server.ts](../electron/main/micro-apps/server.ts), CSP wiring shared with W1/W3.
- **Acceptance:** a fresh app cannot reach `https://www.googleapis.com`; after the
  user approves that host for that app, it can — and *only* that host; a second
  app gets no access; editing the manifest to add a host without re-approval does
  **not** widen egress.

### W7 — Credential broker (secrets never enter the frame)

A hostile frame must never hold a raw OAuth token. Credentialed external calls are
proxied by the main process, which injects auth server-side. **Larger design —
likely a follow-up milestone, not the first `/goal` pass — but the plan must name
it because W6 egress to an authed API is only safe with it.**

- `[ ]` Design a broker endpoint (loopback, per-app-scoped, unguessable token in
  the iframe URL or postMessage handshake) that the frame calls instead of the
  third-party API directly. The broker holds credentials (via existing
  [secret-store](../electron/main/secrets)) and forwards only to that app's
  approved hosts (reuses the W6 allowlist).
- `[ ]` Ensure the broker token is per-app and not reachable cross-app; the broker
  enforces the W6 host allowlist on every forwarded request.
- `[ ]` Reconcile with the OAuth connection flow (how a user links, e.g., Google)
  — almost certainly handled in main, never in the frame.
- **Files:** new `electron/main/micro-apps/broker.ts`, integration with
  [secrets](../electron/main/secrets) and W6 capabilities.
- **Acceptance:** a micro-app makes an authenticated call to an approved API
  without the token ever appearing in frame-readable JS / network from the frame;
  a different app cannot use the first app's broker token.

---

## Verification

Per-workstream acceptance criteria above are the unit checks. End to end:

1. **Functional regression:** start an existing micro-app via
   `view_app({ path: "/micro/<name>" })` and confirm it renders and behaves after
   W1–W7.
2. **Default egress closed:** with no grant, `fetch('https://example.com')` inside
   the frame is refused by CSP (W1) and any media/geo permission is denied (W2).
3. **Granted egress works and is scoped:** after a user approves a host for one
   app (W6), that app reaches only that host; a second app gets nothing; a
   manifest edit without re-approval does not widen egress.
4. **No frame escape / no shell nav:** frame cannot reach `window.top`;
   `window.open` and external top-nav from the shell are denied (W5).
5. **No install-time RCE:** the postinstall-sentinel test app (W4) leaves no
   sentinel, in dev and a packaged build.
6. **Secrets stay out of the frame:** an authenticated brokered call (W7) never
   exposes the token to frame-readable JS; cross-app broker access is denied.
7. **Typecheck:** `bun run typecheck` clean after the main-process edits.

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

## Sequencing

- **W1** and **W4** first — highest value/risk, mostly independent. W1 is
  renderer-only (hot-reloads); W4 is a one-line main-process change. These two
  alone close the worst gaps (frame egress floor + install-time RCE).
- **W2 + W3 + W5** are all main-process session/window policy — do them together
  in one pass (likely one new `session-policy.ts` + a window.ts edit) since they
  share bootstrap and a single restart to verify.
- **W6** depends on W1 (it widens the per-app CSP W1 establishes) and on the
  W3 header-injection path. Do it after the W1–W5 floor is in place.
- **W7** depends on W6 (reuses its host allowlist) and is the largest piece — a
  reasonable **second `/goal`/milestone** once W1–W6 land. Until W7 ships, do not
  let micro-apps connect to services that require user secrets.
- Everything in W2–W7 touches `electron/main/**`, which **restarts the app** —
  batch the verification.

## Follow-ups (out of scope)

- Constrained child process for micro-app build/serve (the real RCE fix beyond W4).
- Request-level (not just host-level) policy on brokered calls.
- Apply the same `setWindowOpenHandler` + `will-navigate` guards to the snapshot
  window ([window.ts:43](../electron/main/window.ts#L43)).
