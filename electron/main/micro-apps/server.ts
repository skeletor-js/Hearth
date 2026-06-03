// One Vite dev server per micro-app. The renderer embeds the returned URL in a
// sandboxed <iframe>. Servers are kept in a map so we can stop them and avoid
// leaking ports across the app's lifetime.
//
// A micro-app is its own isolated Vite + React project with its own deps. We run
// its vite from its OWN node_modules so we don't depend on a global install, and
// install deps on first start if they're missing.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { assertAppName } from './validate.js'

interface RunningApp {
  child: ChildProcess
  url: string
}

export interface MicroAppInfo {
  name: string
  running: boolean
}

const running = new Map<string, RunningApp>()

// vite prints something like "  ➜  Local: http://localhost:5173/". Match the
// first loopback URL on the line, tolerating surrounding text and ANSI codes.
const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/

const START_TIMEOUT_MS = 30_000

// Pure, unit-testable: pull the dev-server URL out of a vite output chunk.
export function extractDevUrl(chunk: string): string | null {
  const match = chunk.match(URL_RE)
  return match ? match[1] : null
}

function microAppDir(repoRoot: string, name: string): string {
  assertAppName(name)
  const appsDir = join(repoRoot, 'micro-apps')
  const dir = join(appsDir, name)
  // Defense in depth: even a regex-passing name must resolve inside micro-apps/.
  if (!resolve(dir).startsWith(resolve(appsDir) + sep)) {
    throw new Error(`Invalid app name: ${name}`)
  }
  return dir
}

function viteBin(dir: string): string {
  return join(dir, 'node_modules', '.bin', 'vite')
}

// Install the micro-app's deps with bun. Resolves on a clean exit, rejects with
// a clear message otherwise.
//
// `--ignore-scripts` is a hard security boundary: a micro-app's package.json is
// agent-authored and therefore untrusted, and lifecycle scripts (postinstall et
// al.) run in the MAIN process with full Node privileges. Disabling them stops an
// install-time RCE in both dev and packaged builds (the packaged model still runs
// bun install at runtime). Vite + React need no install scripts to function.
export function installDeps(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['install', '--ignore-scripts'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString()
    })
    child.on('error', (err) => reject(new Error(`bun install failed to spawn in ${dir}: ${err.message}`)))
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`bun install failed in ${dir} (exit ${code})${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

export async function startMicroApp(repoRoot: string, name: string): Promise<string> {
  const existing = running.get(name)
  if (existing) return existing.url

  const dir = microAppDir(repoRoot, name)
  if (!existsSync(dir)) throw new Error(`micro-app not found: ${dir}`)

  // Use the micro-app's own vite. If it isn't installed yet, install first.
  if (!existsSync(viteBin(dir))) {
    await installDeps(dir)
    if (!existsSync(viteBin(dir))) {
      throw new Error(`micro-app ${name} has no vite after install (check its package.json)`)
    }
  }

  const child = spawn(viteBin(dir), ['--strictPort=false'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise<string>((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill()
        reject(new Error(`micro-app ${name} did not print a dev URL within ${START_TIMEOUT_MS / 1000}s`))
      })
    }, START_TIMEOUT_MS)

    const onData = (buf: Buffer) => {
      const url = extractDevUrl(buf.toString())
      if (url) finish(() => {
        running.set(name, { child, url })
        resolve(url)
      })
    }

    child.stdout?.on('data', onData)
    child.on('error', (err) => finish(() => reject(err)))
    child.on('exit', (code) => {
      running.delete(name)
      finish(() => reject(new Error(`micro-app ${name} vite exited (${code}) before printing a URL`)))
    })
  })
}

// Map a request origin (e.g. "http://localhost:5183") back to the micro-app it
// belongs to, or null for anything else (the shell, the broker, external APIs).
// session-policy.ts uses this to decide which CSP a response gets.
export function microAppForOrigin(origin: string): string | null {
  for (const [name, app] of running) {
    try {
      if (new URL(app.url).origin === origin) return name
    } catch {
      // ignore an unparseable stored URL
    }
  }
  return null
}

export function stopMicroApp(name: string): void {
  const app = running.get(name)
  if (!app) return
  app.child.kill()
  running.delete(name)
}

export function stopAllMicroApps(): void {
  for (const name of running.keys()) stopMicroApp(name)
}

// List the scaffolded micro-apps (dirs under micro-apps/ that look like a project),
// with whether each currently has a running dev server. Powers the Tools gallery.
export function listMicroApps(repoRoot: string): MicroAppInfo[] {
  const appsDir = join(repoRoot, 'micro-apps')
  if (!existsSync(appsDir)) return []
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(appsDir, d.name, 'package.json')))
    .map((d) => ({ name: d.name, running: running.has(d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
