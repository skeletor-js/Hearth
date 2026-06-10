---
title: Onboarding resets after restart — Vite port drift wipes localStorage origin
date: 2026-06-09
category: ui-bugs
module: shell
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - Onboarding screen reappears on app restart even though setup was completed
  - Theme and approval-tier preferences reset between dev restarts
  - Persisted zustand state under localStorage key hearth-ui is empty after restart
  - Renderer loads from port 5174+ instead of 5173 after a restart race
root_cause: config_error
resolution_type: code_fix
severity: medium
related_components:
  - development_workflow
tags: [vite, dev-server, localstorage, zustand, origin-drift, onboarding, electron, persistence]
---

# Onboarding resets after restart — Vite port drift wipes localStorage origin

## Problem

After rapid app restarts during dev, Hearth repeatedly bounced an already-onboarded user back through first-run onboarding, and UI prefs (theme, approval tier) reset seemingly at random. The `onboarded` flag and all UI prefs live in localStorage, which is per-origin — and the dev server's port (and thus the origin) can drift across restarts.

## Symptoms

- Onboarding screen reappears after an app restart even though setup was completed earlier.
- Theme, accent, and approval tier silently revert to defaults at the same time.
- Flaky, not deterministic: only some restarts trigger it (the ones that race the previous instance).
- Telltale reads: `localStorage.getItem("hearth-ui")` returns `null` in one session but real data in another; the approval tier flip-flops between `'commands'` and `'auto'` across restarts — two different values that were each "persisted," which means two different stores.

## What Didn't Work

First suspicion: the `onboarded` flag simply isn't persisted across restarts. Wrong — it is. `src/shell/store.ts` wraps the shell store in zustand `persist` under key `hearth-ui`:

```ts
onboarded: false,
setOnboarded: (onboarded) => set({ onboarded }),
// ...
{ name: 'hearth-ui' },
```

localStorage survives restarts fine. The gate in `src/routes/__root.tsx` (`if (!s.onboarded)` renders onboarding) was also correct. Persistence wasn't broken; the app was reading a *different* localStorage than the one it wrote.

## Solution

Branch `fix/onboarding-origin-drift`, one file changed: `src/routes/__root.tsx`, +17 lines. Instead of trusting the origin-scoped flag alone, derive onboarded-ness from durable main-process state. Onboarding means "connect agent + choose workspace," and registered workspaces live in main's on-disk store — origin-independent proof that onboarding already happened.

```tsx
// The onboarded flag lives in localStorage, which is per-ORIGIN — and the dev
// server port (and thus the origin) can drift across app restarts when the
// previous instance hasn't released it yet, bouncing an onboarded user back
// through onboarding with amnesiac prefs. Registered workspaces live in main
// and are the real signal: having any means onboarding already happened, so
// self-heal the flag instead of re-asking.
useEffect(() => {
  if (s.onboarded) return
  let live = true
  void window.hearth.workspaces.list().then((l) => {
    if (live && l.length > 0) s.setOnboarded(true)
  })
  return () => {
    live = false
  }
}, [s.onboarded])
```

Before: missing flag → onboarding screen, full stop. After: missing flag → ask main for workspaces; if any exist, `setOnboarded(true)` and skip straight to the app. The flag then re-persists into the new origin's localStorage, so the heal is one-time per origin.

Verified live: wiped the flag via eval, reloaded — the app self-healed past onboarding (flag back to `true`, rail rendered, no onboarding screen).

## Why This Works

localStorage is keyed by origin (`scheme://host:port`). The renderer loads from electron-vite's dev server, and `electron.vite.config.ts` pins no port — Vite's `strictPort` defaults to `false`. When a restart races the previous instance still holding 5173, the new server silently binds 5174+. New port → new origin → completely empty localStorage. `hearth-ui` is gone, `onboarded` is back to `false`, and every persisted pref is at its default. Nothing was deleted; the data is sitting under the old origin the app no longer loads from.

The fix is robust because it moves the source of truth out of the blast radius. Main's on-disk workspace store doesn't care what origin the renderer happens to load from. The renderer flag becomes what it always actually was — a cache — and the effect rebuilds the cache from durable state whenever it's missing.

## Prevention

- **Treat localStorage as an origin-scoped cache, never as durable truth.** In an Electron dev setup where the renderer URL can vary, anything that must survive restarts belongs in the main process (on-disk store) with the renderer reading or self-healing from it.
- **Optionally pin the port.** Deliberately not done here, but `strictPort` would protect all the other prefs too, by turning the silent drift into a loud boot failure:

  ```ts
  // electron.vite.config.ts → renderer
  server: { hmr: { overlay: false }, strictPort: true },
  ```

  Tradeoff: a restart that races a lingering instance now fails to boot instead of drifting, which changes dev-restart ergonomics. Left as an owner decision.
- **Know the signature of origin drift:** "persisted" state goes amnesiac after restarts, *and* the same key reads back different previously-persisted values across runs (here: approval flip-flopping `'commands'`/`'auto'`). One key, two values, both saved — that's two stores, i.e., two origins. Check `location.origin` across the suspect runs to confirm.
- When debugging "persistence" bugs, verify *which* store you're reading before concluding the write failed — `localStorage.getItem(...) === null` after a confirmed write is an origin/partition question, not a serialization one.

## Related Issues

- None — first entry in the knowledge store (no related docs/solutions entries or GitHub issues at time of writing).
