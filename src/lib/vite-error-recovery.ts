/// <reference types="vite/client" />
// Bridges Vite's HMR error stream into Hearth's ErrorBoundary / CrashSurface (W3).
// Vite's built-in red overlay is disabled (electron.vite.config.ts: hmr.overlay
// false); we forward `vite:error` payloads as window CustomEvents so build / parse
// errors from a self-edit get the same Reload / Repair / Undo controls as a runtime
// render crash. See docs/SELF-MOD-HARDENING-PLAN.md (W3).

export const HEARTH_BUILD_ERROR = 'hearth:build-error'
export const HEARTH_BUILD_ERROR_CLEARED = 'hearth:build-error-cleared'

export interface BuildErrorDetail {
  message: string
  file: string | null
}

interface ViteErrorPayload {
  err?: { message?: string; id?: string; loc?: { file?: string } }
}

if (import.meta.hot) {
  import.meta.hot.on('vite:error', (payload: ViteErrorPayload) => {
    const err = payload?.err ?? {}
    const detail: BuildErrorDetail = {
      message: err.message?.trim() || 'Build error',
      file: err.loc?.file ?? err.id ?? null,
    }
    window.dispatchEvent(new CustomEvent<BuildErrorDetail>(HEARTH_BUILD_ERROR, { detail }))
  })
  // Vite sends a full-reload / update once the error clears.
  import.meta.hot.on('vite:afterUpdate', () => {
    window.dispatchEvent(new CustomEvent(HEARTH_BUILD_ERROR_CLEARED))
  })
}
