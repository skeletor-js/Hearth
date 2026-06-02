// Crash / build-error recovery surface (W3, first line). Shown by ErrorBoundary
// when a self-edit crashes the renderer or fails to build. Offers Reload, Ask
// Hearth to repair (one guarded auto-attempt + a manual button), and Undo latest.
// The authoritative net is main-anchored (see index.ts render-process-gone) — this
// is the in-renderer UX. See docs/completed-plans/SELF-MOD-HARDENING-PLAN.md (W3).

import { useCallback, useEffect, useRef, useState } from 'react'

const SIG_KEY = 'hearth:auto-repair:last-signature'
const COUNT_KEY = 'hearth:auto-repair:session-count'
const MAX_AUTO_REPAIRS = 2

const signature = (s: string): string => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

const repairPrompt = (message: string, file: string | null): string =>
  `A self-edit broke Hearth.\n\n` +
  `Error: ${message}\n` +
  (file ? `Likely file: ${file}\n` : '') +
  `\nPlease repair it now: find and fix the root cause in the code, keep the change ` +
  `minimal, run \`bun run typecheck\`, and commit. Return a short summary of what you changed.`

export function CrashSurface({ message, file }: { message: string; file: string | null }) {
  const [status, setStatus] = useState<'idle' | 'repairing' | 'reverting'>('idle')
  const [note, setNote] = useState('')
  const tried = useRef(false)

  const repair = useCallback(async () => {
    setStatus('repairing')
    setNote('Asking Hearth to repair…')
    try {
      const sessions = await window.hearth.sessions.list()
      const sessionId = sessions[0]?.id
      if (!sessionId) {
        setNote('Open a session, then click "Ask Hearth to repair".')
        setStatus('idle')
        return
      }
      await window.hearth.agent.prompt(sessionId, '', repairPrompt(message, file))
      setNote('Repair requested. The app reloads when the fix lands.')
    } catch (e) {
      setNote(`Repair failed to start: ${String(e)}`)
      setStatus('idle')
    }
  }, [message, file])

  // Auto-repair once per distinct error signature, capped per session, so a repair
  // that keeps producing *different* breakage can't loop.
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    const sig = signature(message)
    const count = Number(sessionStorage.getItem(COUNT_KEY) ?? '0')
    if (localStorage.getItem(SIG_KEY) === sig || count >= MAX_AUTO_REPAIRS) {
      setNote(count >= MAX_AUTO_REPAIRS ? 'Auto-repair limit reached — use the controls below.' : 'Already attempted an auto-repair for this error.')
      return
    }
    localStorage.setItem(SIG_KEY, sig)
    sessionStorage.setItem(COUNT_KEY, String(count + 1))
    void repair()
  }, [message, repair])

  const undoLatest = useCallback(async () => {
    setStatus('reverting')
    try {
      const history = await window.hearth.selfMod.history()
      const latest = history.find((e) => !e.reverted)
      if (!latest) {
        setNote('Nothing to undo.')
        setStatus('idle')
        return
      }
      const r = await window.hearth.selfMod.undo(latest.hash)
      if (r.status === 'ok') window.location.reload()
      else setNote(`Undo: ${r.status}. Try Reload, or resolve in a session.`)
    } finally {
      setStatus('idle')
    }
  }, [])

  return (
    <div className="crash-surface" style={crashWrap}>
      <div style={crashCard}>
        <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font, sans-serif)' }}>Hearth hit a problem</h2>
        <p style={{ color: 'var(--subtle)', margin: '0 0 14px' }}>A self-edit broke the app. It's recoverable — your history is intact.</p>
        <pre style={crashPre}>{message}{file ? `\n  at ${file}` : ''}</pre>
        {note && <p style={{ color: 'var(--subtle)', fontSize: 'var(--t-13)' }}>{note}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
          <button className="btn" disabled={status !== 'idle'} onClick={() => void repair()}>
            {status === 'repairing' ? 'Repairing…' : 'Ask Hearth to repair'}
          </button>
          <button className="btn" disabled={status !== 'idle'} onClick={() => void undoLatest()}>
            {status === 'reverting' ? 'Reverting…' : 'Undo latest'}
          </button>
        </div>
      </div>
    </div>
  )
}

const crashWrap: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--bg, #fff)',
  zIndex: 99999,
  padding: 24,
}
const crashCard: React.CSSProperties = {
  maxWidth: 560,
  width: '100%',
  background: 'var(--bg-panel, #fff)',
  border: '1px solid var(--border-strong, #ddd)',
  borderRadius: 12,
  padding: 24,
}
const crashPre: React.CSSProperties = {
  fontFamily: 'var(--mono, monospace)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  background: 'var(--bg-inset, #f6f6f6)',
  border: '1px solid var(--border, #eee)',
  borderRadius: 8,
  padding: 12,
  maxHeight: 200,
  overflow: 'auto',
}
