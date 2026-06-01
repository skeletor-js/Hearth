import { useEffect, useState } from 'react'
import type { AgentKind } from '../../electron/shared/protocol'

const BACKENDS: { kind: AgentKind; label: string }[] = [
  { kind: 'claude', label: 'Claude' },
  { kind: 'codex', label: 'Codex' },
]

// Switch the live agent backend without restarting. Selecting one tears down the
// current adapter and connects the new one (main side); the control shows a
// connecting state and surfaces a connect error inline.
export function BackendSwitcher() {
  const [kind, setKind] = useState<AgentKind | null>(null)
  const [pending, setPending] = useState<AgentKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setKind)
    return window.hearth.agent.onBackendChanged((status) => {
      setKind(status.kind)
      setError(status.error ?? null)
      setPending(null)
    })
  }, [])

  const select = async (next: AgentKind) => {
    if (pending || next === kind) return
    setPending(next)
    setError(null)
    try {
      const status = await window.hearth.agent.setBackend(next)
      setKind(status.kind)
      setError(status.error ?? null)
    } catch (e) {
      setError(String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mt-auto -mx-3 border-t border-white/8 px-3 pt-3">
      <div className="px-2 pb-2 text-xs font-medium tracking-wide text-white/40">AGENT</div>
      <div className="flex gap-1 rounded-md bg-white/5 p-1">
        {BACKENDS.map((b) => {
          const active = kind === b.kind
          const loading = pending === b.kind
          return (
            <button
              key={b.kind}
              onClick={() => select(b.kind)}
              disabled={pending !== null}
              className={`flex-1 rounded px-2 py-1.5 text-xs transition-colors ${
                active ? 'bg-white/15 text-white' : 'text-white/55 hover:bg-white/10'
              } disabled:opacity-50`}
            >
              {loading ? 'connecting…' : b.label}
            </button>
          )
        })}
      </div>
      {error && <div className="px-1 pt-2 text-xs text-amber-400">{error}</div>}
    </div>
  )
}
