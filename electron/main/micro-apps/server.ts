// One Vite dev server per micro-app. The renderer embeds the returned URL in a
// sandboxed <iframe>. Servers are kept in a map so we can stop them and avoid
// leaking ports across the app's lifetime.
//
// TODO(v1): the simplest working version spawns `vite` as a child process in the
// micro-app dir and parses the printed URL. A later version can use Vite's
// programmatic createServer for cleaner lifecycle + HMR wiring.

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

interface RunningApp {
  child: ChildProcess
  url: string
}

const running = new Map<string, RunningApp>()

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/

export function startMicroApp(repoRoot: string, name: string): Promise<string> {
  const existing = running.get(name)
  if (existing) return Promise.resolve(existing.url)

  const dir = join(repoRoot, 'micro-apps', name)
  const child = spawn('vite', ['--strictPort=false'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })

  return new Promise<string>((resolveUrl, reject) => {
    const onData = (buf: Buffer) => {
      const match = buf.toString().match(URL_RE)
      if (match) {
        const url = match[1]
        running.set(name, { child, url })
        child.stdout?.off('data', onData)
        resolveUrl(url)
      }
    }
    child.stdout?.on('data', onData)
    child.on('error', reject)
    child.on('exit', (code) => {
      running.delete(name)
      if (!running.has(name)) reject(new Error(`micro-app ${name} vite exited (${code}) before printing a URL`))
    })
  })
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
