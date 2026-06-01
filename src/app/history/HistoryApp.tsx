import { useCallback, useEffect, useState } from 'react'

// Mirror of git.ts SelfModLogEntry (the IPC surface is untyped at the boundary).
interface SelfMod {
  hash: string
  subject: string
  conversationId: string | null
  reverted: boolean
}

// The self-modification history: every edit the agent made to Hearth's own
// source, newest first, each revertable. This is the visible form of the safety
// net — "undo that" without going to a terminal.
export function HistoryApp() {
  const [mods, setMods] = useState<SelfMod[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMods((await window.hearth.selfMod.history()) as SelfMod[])
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const undo = async (hash: string) => {
    setBusy(hash)
    setError(null)
    try {
      await window.hearth.selfMod.undo(hash)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pb-4 pt-10 text-sm font-medium text-white/60">Self-mod history</header>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-6">
        {error && <div className="text-sm text-amber-400">{error}</div>}
        {mods.length === 0 && !error && (
          <div className="text-sm text-white/30">No self-modifications yet. Ask Hearth to change itself.</div>
        )}
        {mods.map((m) => (
          <div
            key={m.hash}
            className="flex items-center justify-between gap-3 rounded-md bg-white/[0.03] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`truncate text-sm ${m.reverted ? 'text-white/40 line-through' : 'text-white/85'}`}>
                  {m.subject}
                </span>
                {m.reverted && (
                  <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                    Reverted
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-white/35">{m.hash.slice(0, 8)}</div>
            </div>
            {m.reverted ? (
              <span className="shrink-0 px-3 py-1.5 text-xs text-white/30">Undone</span>
            ) : (
              <button
                onClick={() => undo(m.hash)}
                disabled={busy !== null}
                className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 disabled:opacity-40"
              >
                {busy === m.hash ? 'reverting…' : 'Undo'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
