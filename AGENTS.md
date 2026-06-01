# Working in Hearth

Hearth is a self-evolving desktop client for coding agents. When you run inside
it, **this repo is the running app** and you may be asked to change its own UI.

- The renderer (`src/**`) is served by a live Vite dev server, so your edits
  **hot-reload into the running app** — no restart needed.
- Avoid editing `electron/main/**` and `electron/preload/**` unless the task truly
  needs it: those restart the whole app.
- Your edits are auto-committed as `Hearth-SelfMod` git commits and are revertable
  from the app's History view, so make focused changes.

## Visually verifying UI changes

You can't see the Electron window, but you can capture it. After changing
renderer code, run:

```
node scripts/view-app.mjs
```

This saves a PNG of the live, hot-reloaded app to `.hearth/snapshot.png`. **Open /
view that image** to confirm your change looks right before you finish. Always do
this for tasks about appearance, layout, or styling — don't claim a visual change
works without looking at it.

(The raw dev URL `http://localhost:5173` will NOT render correctly outside the
app — it needs Electron's preload bridge. Use the snapshot script instead.)
