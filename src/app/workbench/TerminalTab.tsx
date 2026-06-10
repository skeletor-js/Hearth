import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import { useTerminalBus } from './terminal-bus'

function themeColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (n: string) => s.getPropertyValue(n).trim()
  return {
    background: v('--bg-inset') || '#1c1b17',
    foreground: v('--default') || '#bab4a9',
    cursor: v('--accent') || '#c8542b',
    selectionBackground: v('--accent-soft') || 'rgba(200,84,43,0.2)',
  }
}

export function TerminalTab() {
  const cwd = useSession((s) => s.active?.cwd)
  const theme = useShell((s) => s.theme)
  const pending = useTerminalBus((s) => s.pending)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const idRef = useRef<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const id = (crypto.randomUUID?.() ?? String(Math.random())).slice(0, 12)
    idRef.current = id
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      theme: themeColors(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term

    window.hearth.terminal.create(id, cwd, term.cols, term.rows)
    const offData = window.hearth.terminal.onData((tid, data) => {
      if (tid === id) term.write(data)
    })
    const offExit = window.hearth.terminal.onExit((tid, reason) => {
      if (tid === id) term.write(`\r\n\x1b[2m[${reason ? `failed to start: ${reason}` : 'process exited'}]\x1b[0m\r\n`)
    })
    const inputSub = term.onData((data) => window.hearth.terminal.write(id, data))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        window.hearth.terminal.resize(id, term.cols, term.rows)
      } catch {
        /* host detached */
      }
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      offData()
      offExit()
      inputSub.dispose()
      window.hearth.terminal.kill(id)
      term.dispose()
      termRef.current = null
    }
    // One PTY per mount; cwd is captured at create time.
  }, [cwd])

  // Re-theme the live terminal when the app theme flips.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themeColors()
  }, [theme])

  // A guided action queued a command — type it into this PTY (not submitted; the
  // user reviews and presses Enter). The delayed take() survives React StrictMode's
  // throwaway first mount (its cleanup cancels the timer before it consumes) and
  // gives the PTY time to spawn before we write. Consume-once across terminals.
  useEffect(() => {
    if (pending == null) return
    const t = setTimeout(() => {
      const id = idRef.current
      const cmd = useTerminalBus.getState().take()
      if (cmd && id) {
        window.hearth.terminal.write(id, cmd)
        termRef.current?.focus()
      }
    }, 350)
    return () => clearTimeout(t)
  }, [pending])

  return <div ref={hostRef} className="term-host" style={{ height: '100%', width: '100%', padding: 8 }} />
}
