# Milestone v1 — "It edits itself"

The smallest build that proves the core loop. Claude-only. Dev mode (which
already gives live HMR + self-edit; the packaged self-evolving build is a later
milestone). macOS only.

## Definition of done

A running Electron app where you can:

1. **Talk to Claude Code over ACP.** Type a prompt in the chat sidebar app, see
   the streamed ACP response, approve a tool/permission request.
2. **Have it edit itself.** Ask "change the sidebar title to X" → the agent edits
   `src/...` → Vite HMR reflects it live without a manual reload.
3. **Commit + revert.** Each self-edit lands as a git commit. "Undo that" reverts
   the last self-mod commit and HMR rolls the UI back.
4. **Run one micro-app.** `create-app demo` scaffolds a standalone app; the shell
   embeds it in a sandboxed iframe against its Vite server.

That's the whole loop: agent → self-edit → HMR → git history. Everything else is
expansion.

## Build order

All shipped (see docs/BUILD-PLAN.md for the per-track detail; 254 tests pass,
typecheck/lint/build green).

- [x] **0. Boot.** `bun install`, `bun dev` opens a window rendering the shell.
- [x] **1. Preload bridge.** `window.hearth` typed API, contextIsolation on.
- [x] **2. ACP client.** Spawn `@zed-industries/claude-agent-acp`, open a session,
      stream `session/update` to the renderer, handle permission requests.
- [x] **3. Chat sidebar app.** `src/app/chat/` + route; send prompt, render stream.
- [x] **4. git service.** `dugite`: commit-per-edit with a conversation trailer;
      `revert` last self-mod commit.
- [x] **5. HMR classify+apply.** Port Stella's `path-relevance.ts` + `hmr.ts`
      minimal path: renderer edits HMR, route/main edits escalate.
- [x] **6. Micro-app.** `scaffold.ts` + `server.ts` + iframe host component.

The one remaining v1 step is observation, not construction: a live talk →
self-edit → HMR → undo turn on real hardware, then the `v1` git tag (gated on
running outside the sandbox; see docs/V2-PACKAGING-PLAN.md WS1).

## Out of scope for v1 (status)

- ~~Codex backend~~ — DONE post-v1 ([codex.ts](../electron/main/agents/codex.ts)).
- ~~Packaged/notarized build that ships its own Vite server~~ — IMPLEMENTED (v2,
  see [V2-PACKAGING-PLAN.md](completed-plans/V2-PACKAGING-PLAN.md) WS2:
  [workspace.ts](../electron/main/packaging/workspace.ts),
  [renderer-server.ts](../electron/main/packaging/renderer-server.ts),
  electron-builder config + entitlements). A real `bun run dist` + notarization
  run remains environment-gated.
- Auto-update, the Store, multi-window, voice, mobile bridge.
- Sandboxing hardening beyond the iframe `sandbox` attribute.

## Risk notes

- **Hardest piece is step 5.** Budget for it; lean on Stella's `runtime/kernel/
  self-mod/`. Get commit/revert (step 4) solid first — it's the safety net that
  makes the rest safe to iterate on.
- **ACP permission flow** is easy to under-build. Real agents request file/exec
  permissions mid-turn; the renderer must surface and answer them or the agent
  hangs.
- **Auth:** test with a user-authenticated local Claude Code. Do not bake any
  credential into the app.
