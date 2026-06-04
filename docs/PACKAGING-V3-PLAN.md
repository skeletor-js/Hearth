# Packaging v3: signed shell + downloaded payload (the Stella model)

Status: IMPLEMENTED (Electron shell variant). Supersedes the bundle-everything
approach in `docs/completed-plans/V2-PACKAGING-PLAN.md`.

Result: the signed `.app` dropped from 2.1 GB to **770 MB** and signs with a valid
Designated Requirement. The renderer source + its `node_modules` now ship as a
**277 MB `.tar.gz` workspace payload** downloaded from R2 (sha256-verified) on
first run/upgrade. Built: `electron/main/packaging/payload.ts` (download/verify/
extract/seed), `bootstrap-splash.ts` (first-run progress), the rewritten
`resolveRepoRoot` in `index.ts`, `scripts/build-workspace-payload.mjs`
(`payload:build` / `release`). Verified: typecheck + lint + 0-fail tests; an
end-to-end harness (download → sha256 → extract → seed → reuse → mismatch-reject)
passed 10/10. The Tauri-launcher variant (~10 MB shell) remains a later option;
the payload + manifest + R2 half is identical, so swapping the shell later needs
no payload rework.

Deferred polish (not blockers): the 770 MB shell can shrink further (enable asar
for app code; the in-app Vite toolchain is the bulk and could move to the payload);
no app icon yet; payload uses gzip (Node here lacks zstd) instead of Stella's zstd.

## Problem

The current signed `.app` is 2.1 GB / 34k files because `build.extraResources`
copies the entire dev `node_modules` (incl. a nested 242 MB `electron/dist/
Electron.app`) and the source tree into `Contents/Resources/app-source`. That
bundle is slow and fragile to codesign, painful to notarize, and would make every
auto-update a 2 GB download. Shipping a self-modifying payload inside a notarized
bundle is the wrong shape.

## How Stella does it (reference, from `github.com/ruuxi/*`, Apache-2.0)

Two artifacts, one signed:

1. **Launcher** (`ruuxi/stella-launcher`): a Tauri (Rust) app. The distributed
   DMG is **10.85 MB**. This is the only thing signed + notarized. It self-installs
   (copies to a permanent location, relaunches), then bootstraps the real app.
2. **App payload** (`ruuxi/stella`, an Electron app): never shipped in the DMG.
   The launcher reads a manifest from R2 and downloads a compressed tarball:
   - `…r2.dev/desktop/current.json` →
     `{ tag, commit, assets: { "darwin-arm64": { url, sha256, size } } }`
   - asset is `stella-desktop-darwin-arm64.tar.zst` (560 MB compressed, ~3.7 GB
     hydrated), sha256-verified, extracted into a writable dir set up as a git
     clone for self-modification.
   - Native helper binaries (ripgrep, etc.) are a separate artifact + manifest.
   - Updates: launcher sees a new `current.json`, downloads the new tarball.
     **No re-signing or re-notarization of the heavy app, ever.** Only the rarely
     changing launcher is notarized.

Key insight: the signed artifact is small and stable; the heavy, self-modifying
payload lives in a writable dir and is delivered/updated as data. Stella's app is
actually bigger than ours hydrated. The difference is purely that they never put
it inside a signed bundle.

## Target architecture for Hearth

Same split, but keep the shell as Electron (smallest delta from today; reuses our
existing main/preload and the writable-workspace runtime we already have):

- **Signed shell** (Electron, electron-builder): `out/main`, `out/preload`,
  `out/renderer`, `package.json`, and the production `node_modules` the *main
  process* needs (ACP adapters, dugite, node-pty, electron-updater). No
  `app-source`. Expected size a few hundred MB. Signs + notarizes normally.
- **Workspace payload** (downloaded, unsigned): the renderer source tree (`src`,
  `index.html`) plus the `node_modules` the in-app Vite server needs at runtime.
  Delivered as `hearth-workspace-<ver>.tar.zst` on R2 with a `current.json`
  manifest (version, commit, url, sha256, size). Extracted into
  `userData/workspace` and run from there. Self-mod and payload updates happen
  here, unsigned.

We already run from `userData/workspace` (see `ensureWorkspace`). The only change
is how that workspace is seeded: download + verify + extract, instead of copy from
`Resources/app-source`.

## Manifest schema (`workspace/current.json` on R2)

Mirror Stella's `current.json`:

```json
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "commit": "<git sha>",
  "minShellVersion": "0.1.0",
  "asset": {
    "url": "https://pub-…r2.dev/workspace/releases/0.1.0/hearth-workspace-0.1.0.tar.zst",
    "sha256": "…",
    "sizeBytes": 123456789
  }
}
```

`minShellVersion` lets a payload require a newer shell (so a payload that needs a
new IPC/main capability won't run against an old shell; the shell updates via
electron-updater first).

## Runtime / bootstrap flow

In `resolveRepoRoot()` (packaged branch), replace the `app-source` copy with a
download. New `ensureWorkspace` responsibility:

1. Read local `workspace/.hearth-workspace-version`.
2. Fetch `current.json`. If unreachable and a workspace already exists, reuse it
   (offline-tolerant after first run). If no workspace and offline, show a
   blocking "needs internet for first run" screen (Stella requires this too).
3. If `current.version` != local and `shellVersion >= minShellVersion`:
   - Download the `.tar.zst` to a temp file with resumable + retried download
     (Range/Content-Range, ~5 attempts), verify sha256.
   - Extract into `workspace.next/`, strip quarantine (`xattr -dr
     com.apple.quarantine`), then atomically swap `workspace` ← `workspace.next`
     (keep `workspace.prev` for rollback).
   - `git` init/commit the new baseline (preserve prior self-mod history if we
     migrate the `.git`, same as today's reseed) and write the version marker.
4. Launch the Vite server rooted at `workspace` (unchanged from today).

Boot watchdog stays as-is: if a freshly swapped payload bricks boot, roll back to
`workspace.prev` and relaunch.

## Build & publish pipeline (two outputs)

1. `electron-vite build` (unchanged) → `out/`.
2. **Shell**: `electron-builder --mac` with `app-source` removed from
   `extraResources`. Produces signed + notarized `Hearth-<ver>.dmg` / `.zip` /
   `latest-mac.yml`. Publish to R2 (existing `publish-update.mjs` path) so the
   shell still auto-updates via electron-updater.
3. **Payload**: new `scripts/build-workspace-payload.mjs`:
   - Assemble `src` + `index.html` + a pruned `node_modules` (runtime deps the
     Vite server needs; see below) into a staging dir.
   - `tar --zstd` it, compute sha256, write `current.json`.
   - Upload tarball + `current.json` to R2 under `workspace/` (reuse the S3 client
     in `publish-update.mjs`).
4. `bun run release` runs shell publish + payload publish.

### Producing the payload `node_modules` (the prune)

The Vite server needs the renderer's runtime + build deps (vite, the react
plugin, esbuild, rollup, react, react-dom, @tanstack/*, zustand, phosphor, plus
all `src` imports and their transitive deps). It does NOT need desktop packaging
tooling. Two options:

- **A (denylist copy, fast to ship):** copy `node_modules`, then delete a known
  build-only set: `electron`, `electron-builder`, `app-builder-*`,
  `@electron/notarize`, `electron-rebuild`, `electron-osx-sign`, `dmg-license`,
  `@aws-sdk`, `electron-updater`, plus the `.bin/* N` iCloud cruft. Removes the
  nested Electron.app and the heaviest junk. Pragmatic for v1.
- **B (clean install, correct long-term):** a dedicated `workspace/package.json`
  listing exactly the renderer runtime + Vite toolchain; `bun install` it fresh
  into the payload. Deterministic, smallest, no denylist drift. More upfront work.

Recommend A for the first cut, migrate to B once the split is proven.

## Signing / notarization boundary + macOS gotchas

- Only the shell is signed + notarized. The payload is data; extracted files are
  not Gatekeeper-checked as a launched `.app`.
- **Quarantine:** files downloaded by the app get `com.apple.quarantine`. Strip it
  on the extracted tree (`xattr -dr com.apple.quarantine workspace`) or the first
  `node`/`.node` load can be blocked.
- **Native modules in the payload** (node-pty, dugite's git, anything the Vite
  server or its deps dlopen): loadable under our existing hardened-runtime
  entitlements (`disable-library-validation`, `allow-unsigned-executable-memory`,
  `allow-jit`). These already exist in `build/entitlements.mac.plist`. Keep them.
  Native modules used by the *main process* stay in the signed shell and are
  signed normally.
- The shell executes JS from a user-writable dir (the Vite server + renderer).
  That is fine for a notarized Electron app with these entitlements; it is what we
  already do today via the copied workspace.

## Migration steps (file by file)

1. `package.json` `build`: delete the three `app-source` entries from
   `extraResources`. Leave `files` as-is (`out/**`, `package.json`,
   `node_modules/**`); electron-builder already prunes devDeps and excludes the
   `electron` package, so the shell's bundled `node_modules` is production-only and
   has no nested Electron.app (verified).
2. `electron/main/index.ts` `resolveRepoRoot()`: drop `sourceDir =
   resourcesPath/app-source`; call the new download-based `ensureWorkspace` with
   the manifest URL + `userData/workspace`.
3. `electron/main/packaging/workspace.ts`: replace the copy/symlink seed with
   fetch-manifest → download → sha256 → extract → atomic swap → version marker +
   git baseline. Keep `decideWorkspaceAction` semantics (seed/reuse/reseed), add
   `offline-reuse` and `needs-network-first-run`.
4. New `scripts/build-workspace-payload.mjs` and `publish:payload` /
   `release` scripts.
5. `electron/main/updater.ts` (already built): unchanged in role. It updates the
   *shell* only. Add a short note that payload updates are separate.
6. Docs: fold `AUTO-UPDATE.md` shell-vs-payload distinction in; mark
   V2-PACKAGING-PLAN superseded.

## Edge cases / failure handling

- Partial/failed download: resume + retry, sha256 gate, atomic swap so a half
  payload never runs.
- Bricked payload after swap: boot watchdog rolls back to `workspace.prev`.
- Offline first run: blocking, friendly "connect to finish setup" screen.
- Disk space: pre-check headroom (Stella reserves ~6 GB) before download/extract.
- Shell too old for payload: `minShellVersion` gate → prompt shell update first.
- Self-mod history across payload updates: migrate the workspace `.git` so prior
  self-mods stay as revertable commits (same intent as today's reseed).

## Open decisions for you

1. **Shell stays Electron, or go full Tauri launcher like Stella?** Electron shell
   is the smaller delta and reuses our main/preload. A Tauri launcher is ~10 MB vs
   ~200 MB and matches Stella exactly, but it is a separate Rust app to build and
   sign. Recommend: Electron shell now, consider a Tauri launcher later if shell
   size matters.
2. **Payload node_modules: denylist copy (A) or clean install (B)?** Recommend A
   first, B later.
3. **Hosting:** reuse the `hearth-updates` R2 bucket with a `workspace/` prefix,
   or a second bucket. Recommend same bucket, new prefix.

## What is already in place (reused, not redone)

- R2 bucket `hearth-updates` + public URL + token, round-trip verified.
- `scripts/publish-update.mjs` S3 upload machinery (extend for the payload).
- electron-updater shell auto-update (`updater.ts` + UI) stays as the shell
  update channel.
- Apple cert + notarization creds in `.env.release`.
- The writable-workspace runtime (`ensureWorkspace`, Vite-from-workspace, boot
  watchdog) stays; only the seed source changes.
