import type { HearthApi } from '../electron/preload/index.js'

declare global {
  interface Window {
    hearth: HearthApi
  }
}

export {}
