# Auto-update

Hearth ships signed, notarized macOS builds and updates them over a Cloudflare
feed. The app checks in the background, downloads a new build, and because we
never apply silently, raises a banner so the user clicks **Restart to update**.

> Two update channels (see `docs/PACKAGING-V3-PLAN.md`): this electron-updater
> flow updates the **signed shell** (rare). The **workspace payload** (renderer
> source + node_modules, the part that self-modifies and changes often) updates
> separately via its own `workspace/current.json` manifest, downloaded on launch
> by `packaging/payload.ts`. No re-notarization for payload updates.

## How it works

- **Feed**: electron-builder's `generic` publish provider (in `package.json`
  `build.publish`) points at a public Cloudflare URL. The app embeds only that
  URL — **no token ships in the app**. electron-updater polls
  `<url>/latest-mac.yml`.
- **In the app**: `electron/main/updater.ts` checks on boot and every 6h,
  downloads in the background, and pushes status on the `update:status` IPC
  channel. `window.hearth.update` exposes `get/check/install/onStatus`. The UI is
  a global restart banner (`src/shell/UpdateBanner.tsx`) plus an Updates row in
  Settings → About. In dev (unpacked) it's an inert no-op that reports
  `unsupported`.
- **Apply**: clicking restart calls `autoUpdater.quitAndInstall()`. macOS only
  applies a build signed with the **same Developer ID** and notarized —
  Squirrel.Mac verifies the signature. So auto-update only works on builds
  produced by the signed `bun run dist` flow.
- **Self-mod interplay**: a new bundle has a bumped `version`; on next launch
  `ensureWorkspace` (packaging/workspace.ts) sees the version change and lays the
  new shipped source over the writable workspace, preserving self-mod history as
  commits. The updater refuses to restart while a self-mod restart is already
  armed.

## One-time Cloudflare setup

1. Create an **R2 bucket** (e.g. `hearth-updates`).
2. Give it a public base URL — either enable the `r2.dev` public URL or attach a
   **custom domain** (recommended: `https://updates.hearth.app`).
3. Set `build.publish[0].url` in `package.json` to that base URL (with trailing
   slash). It must resolve `<url>/latest-mac.yml` publicly.
4. Create an **R2 API token** (Object Read & Write) for the bucket — these creds
   live only on your build machine.

## Releasing

1. Bump `version` in `package.json` (updates only trigger on a higher version).
2. Build signed + notarized (see `docs` packaging notes):
   ```bash
   export APPLE_ID=... APPLE_TEAM_ID=... APPLE_APP_SPECIFIC_PASSWORD=...
   bun run dist
   ```
3. Upload the artifacts to R2:
   ```bash
   export R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   export R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=hearth-updates
   bun run publish:update
   ```
   Or do both in one step: `bun run release`.

`publish:update` uploads `latest-mac.yml`, the `.zip` (+ `.blockmap`), and the
`.dmg` from `release/`. `latest-mac.yml` is uploaded with `no-cache` so clients
see the release immediately; the versioned artifacts are cached immutably.

## Verifying an update end to end

1. Install version N (from the `.dmg`), quit.
2. Bump to N+1, `bun run release`.
3. Open version N → within ~8s it downloads in the background → the restart
   banner appears → click it → it relaunches as N+1 (check Settings → About).

If the banner never appears: confirm `latest-mac.yml` is reachable at the public
URL, the new build's version is higher, and the build is notarized (an unsigned
or un-notarized build downloads but won't apply).
