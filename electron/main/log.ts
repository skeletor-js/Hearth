// Main-process file logging (U14). A self-modifying, auto-updating,
// headless-routine-running app needs something the owner can read when it
// misbehaved while nobody watched — this is that file, nothing more
// (file-only by design, KTD-4: no crash-reporting SaaS for an audience of one).
//
// Lines mirror to the console so dev behavior is unchanged; the file is the
// field artifact. Sync appends: the volume is a handful of lines per session,
// and sync is what lets the uncaught-exception handler flush before dying.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  /** The file lines land in (for the Settings reveal affordance). */
  readonly file: string
}

const MAX_BYTES_DEFAULT = 1024 * 1024 // 1 MB, then one rotation kept

export function createLogger(dir: string, opts?: { maxBytes?: number }): Logger {
  const maxBytes = opts?.maxBytes ?? MAX_BYTES_DEFAULT
  const file = join(dir, 'main.log')
  mkdirSync(dir, { recursive: true })

  const write = (level: 'info' | 'warn' | 'error', args: unknown[]): void => {
    try {
      try {
        if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`)
      } catch {
        // no file yet — nothing to rotate
      }
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${format(...args)}\n`)
    } catch {
      // Logging must never take the app down; the console mirror still has it.
    }
  }

  return {
    file,
    info: (...args) => {
      write('info', args)
      console.log(...args)
    },
    warn: (...args) => {
      write('warn', args)
      console.warn(...args)
    },
    error: (...args) => {
      write('error', args)
      console.error(...args)
    },
  }
}

// The app-wide instance. Call sites import `log` directly; before initLogger
// runs (or in tests/scripts with no userData) it falls through to the console,
// so nothing depends on init order.
let current: Logger | null = null

export function initLogger(dir: string, opts?: { maxBytes?: number }): Logger {
  current = createLogger(dir, opts)
  return current
}

/** Where the log file lives, once initialized (null before). */
export function logFile(): string | null {
  return current?.file ?? null
}

export const log = {
  info: (...args: unknown[]): void => (current ? current.info(...args) : console.log(...args)),
  warn: (...args: unknown[]): void => (current ? current.warn(...args) : console.warn(...args)),
  error: (...args: unknown[]): void => (current ? current.error(...args) : console.error(...args)),
}
