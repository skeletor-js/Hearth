// Resolves what the main window loads the renderer from, and (in a packaged
// self-evolving build) starts the Vite server that backs it.
//
// In dev, electron-vite injects ELECTRON_RENDERER_URL pointing at its Vite
// server — that server is what makes renderer self-edits hot-reload.
//
// The packaged *self-evolving* build does NOT load a frozen bundle. It starts its
// own Vite server on launch, rooted at the writable workspace (see workspace.ts),
// and loads that URL — so the same hot-reload path exists in production. If the
// server fails to start, it falls back to the static bundle so the app still
// launches (without live self-evolution). See docs/V2-PACKAGING-PLAN.md (WS2-2/3).

import { join } from 'node:path'
import { startRendererServer } from './packaging/renderer-server.js'

export interface RendererTarget {
  /** Load via loadURL when set (dev, or the packaged Vite server). */
  url?: string
  /** Else load this file (packaged static fallback). */
  file?: string
}

export interface PreparedRenderer {
  target: RendererTarget
  /** Stop the runtime Vite server; a no-op in dev and in the static fallback. */
  close: () => Promise<void>
}

const NOOP_CLOSE = async (): Promise<void> => {}

/** The packaged static bundle, emitted next to the main bundle by electron-vite. */
function staticIndex(): string {
  return join(__dirname, '../renderer/index.html')
}

/**
 * Decide how to load the renderer and, when packaged, bring up the Vite server.
 * `repoRoot` is the writable workspace the server is rooted at.
 */
export async function prepareRenderer(repoRoot: string): Promise<PreparedRenderer> {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return { target: { url: devUrl }, close: NOOP_CLOSE }

  try {
    const server = await startRendererServer(repoRoot)
    return { target: { url: server.url }, close: server.close }
  } catch (err) {
    console.error('[hearth] renderer Vite server failed to start; falling back to static bundle:', err)
    return { target: { file: staticIndex() }, close: NOOP_CLOSE }
  }
}
