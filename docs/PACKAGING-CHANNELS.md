# The two release channels, and why dependency placement looks backwards

Hearth ships in two pieces (packaging v3):

1. **The signed shell** — the DMG/zip electron-builder produces. Contains
   `out/**` (main + preload bundles) and `node_modules/**` from package.json
   `dependencies`. Signed + notarized; updated via electron-updater.
2. **The workspace payload** — `hearth-workspace-<version>.tar.gz`, built by
   `scripts/build-workspace-payload.mjs` and downloaded from R2 on first launch
   (sha256-verified). Contains `index.html`, `src/**`, and a `node_modules/`
   holding ONLY the renderer's runtime dependency closure. This is the writable
   workspace the packaged app's own Vite server roots at, so self-mods
   hot-reload in production exactly as in dev.

The placement rule that looks wrong but is load-bearing:

- **`dependencies` = what the SHELL needs at runtime.** That's why `vite`,
  `@vitejs/plugin-react`, `@tailwindcss/vite`, and `@tanstack/router-plugin`
  are dependencies: `packaging/renderer-server.ts` dynamic-imports them in the
  packaged app to run the workspace's Vite server. They are NOT renderer
  imports.
- **The renderer's packages ride the PAYLOAD, not the shell.** `react`,
  `react-dom`, `zustand`, `@tanstack/react-router` live in `devDependencies`
  precisely so electron-builder does NOT pack them into the signed bundle —
  the payload builder computes them from the actual imports under `src/`
  (bare-specifier scan → dependency closure over the local `node_modules`).

So: moving `react` into `dependencies` would bloat the signed shell with
packages it never resolves, and moving `vite` into `devDependencies` would
break the packaged app's renderer server. Leave both where they are.

The payload builder fails the build if packaging/build tooling (`electron`,
`@aws-sdk/client-s3`, `tar`, …) ever enters the computed closure — that means
a renderer import is wrong, not that the list needs editing.
