// Runtime Vite server for the packaged self-evolving build (v2, WS2-2).
//
// In dev, electron-vite runs the renderer's Vite server and injects its URL via
// ELECTRON_RENDERER_URL. The packaged self-evolving build has no such server, so
// it starts one itself — the SAME server, pointed at the writable workspace
// (see workspace.ts) — so agent self-edits hot-reload in production exactly as in
// dev. This mirrors the renderer config in electron.vite.config.ts; the two must
// stay in sync (plugins, alias, hmr overlay off).
//
// vite and the renderer plugins are loaded lazily (dynamic import) so this cost is
// paid only when actually starting the server — never in dev, where the env URL is
// used instead. They ship as runtime dependencies (see package.json + the
// electron-builder `files`/`extraResources`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ViteDevServer } from 'vite'
import { selfModOverlay } from '../../vite-plugins/self-mod-overlay.js'

export interface RendererServer {
  url: string
  close: () => Promise<void>
}

/**
 * Start the renderer's Vite server rooted at the writable workspace and return its
 * local URL. The self-mod overlay plugin is wired in with `root` as its repo root,
 * so pinned-baseline serving and atomic HMR work identically to dev.
 */
export async function startRendererServer(root: string): Promise<RendererServer> {
  const [{ createServer }, react, tailwind, routerPlugin] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react').then((m) => m.default),
    import('@tailwindcss/vite').then((m) => m.default),
    import('@tanstack/router-plugin/vite'),
  ])

  const server = await createServer({
    configFile: false, // build the config inline; do not read electron.vite.config.ts
    root,
    resolve: { alias: { '@': join(root, 'src') } },
    // Bind loopback only; an ephemeral port avoids clashing with a user's own dev
    // servers. HMR overlay stays off — self-mod build errors route to Hearth's own
    // crash surface (src/lib/vite-error-recovery.ts), same as dev.
    server: { host: '127.0.0.1', strictPort: false, hmr: { overlay: false } },
    plugins: [
      selfModOverlay(root),
      routerPlugin.tanstackRouter({ target: 'react', routesDirectory: join(root, 'src/routes') }),
      react(),
      tailwind(),
    ],
  })

  await server.listen()
  const url = resolveLocalUrl(server)

  // Record the URL the way the v1 bridge records its own (gitignored .hearth/),
  // for parity and debugging. Best-effort: the in-process `url` is the source of
  // truth, not this file.
  try {
    mkdirSync(join(root, '.hearth'), { recursive: true })
    writeFileSync(join(root, '.hearth', '.vite-dev-url'), url + '\n')
  } catch {
    // ignore — the file is informational only.
  }

  return { url, close: () => server.close() }
}

function resolveLocalUrl(server: ViteDevServer): string {
  const local = server.resolvedUrls?.local?.[0]
  if (local) return local
  const addr = server.httpServer?.address()
  if (addr && typeof addr === 'object' && addr) return `http://127.0.0.1:${addr.port}/`
  throw new Error('renderer Vite server started but exposed no local URL')
}
