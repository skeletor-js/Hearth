// Resolves the URL the main window loads the renderer from.
//
// In dev, electron-vite injects ELECTRON_RENDERER_URL pointing at its Vite
// server — that server is what makes renderer self-edits hot-reload.
//
// The packaged *self-evolving* build (v2) does NOT load a frozen bundle. It
// ships a Vite server, starts it on launch, writes the URL to `.vite-dev-url`,
// and loads that — so the same hot-reload path exists in production. That work
// is deferred; see docs/ARCHITECTURE.md. For now, packaged builds fall back to
// the static bundle so `electron-vite preview` works.

import { join } from 'node:path'

export interface RendererTarget {
  /** Load via loadURL when set (dev, or v2 packaged Vite server). */
  url?: string
  /** Else load this file (packaged static fallback). */
  file?: string
}

export function resolveRendererTarget(): RendererTarget {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return { url: devUrl }

  // TODO(v2): start the shipped Vite server here and return its URL instead,
  // to keep self-evolution working in the packaged app.
  return { file: join(__dirname, '../renderer/index.html') }
}
