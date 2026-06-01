// PTY manager for the Terminal tab. One real shell per terminal id (the renderer
// generates an id per panel), spawned in the session's workspace cwd. Output is
// streamed to the renderer; input/resizes flow back. node-pty is a native module
// (rebuilt for Electron via the postinstall electron-rebuild step).

import * as pty from 'node-pty'
import { platform, env } from 'node:process'

export interface PtyHandle {
  proc: pty.IPty
  offData: () => void
  offExit: () => void
}

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string) => void

export class TerminalManager {
  private terms = new Map<string, PtyHandle>()

  constructor(
    private readonly onData: DataCb,
    private readonly onExit: ExitCb,
  ) {}

  private defaultShell(): string {
    if (platform === 'win32') return env.COMSPEC || 'powershell.exe'
    return env.SHELL || '/bin/zsh'
  }

  create(id: string, cwd: string, cols = 80, rows = 24): void {
    if (this.terms.has(id)) return
    const proc = pty.spawn(this.defaultShell(), [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: { ...env, TERM: 'xterm-256color' } as Record<string, string>,
    })
    const dataSub = proc.onData((data) => this.onData(id, data))
    const exitSub = proc.onExit(() => {
      this.onExit(id)
      this.kill(id)
    })
    this.terms.set(id, { proc, offData: () => dataSub.dispose(), offExit: () => exitSub.dispose() })
  }

  write(id: string, data: string): void {
    this.terms.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.terms.get(id)?.proc.resize(cols, rows)
    } catch {
      /* terminal may have exited mid-resize */
    }
  }

  kill(id: string): void {
    const h = this.terms.get(id)
    if (!h) return
    h.offData()
    h.offExit()
    try {
      h.proc.kill()
    } catch {
      /* already gone */
    }
    this.terms.delete(id)
  }

  disposeAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id)
  }
}
