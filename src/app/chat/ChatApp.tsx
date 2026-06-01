import { useEffect, useRef, useState } from 'react'

interface Line {
  id: number
  role: 'you' | 'assistant' | 'system'
  text: string
}

// Minimal chat sidebar app. Sends a prompt to the agent (over ACP, via main)
// and renders the streamed updates. This is intentionally thin — it's the kind
// of file the agent itself will rewrite when you ask it to change the UI.
export function ChatApp() {
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const nextId = useRef(0)

  const add = (role: Line['role'], text: string) =>
    setLines((prev) => [...prev, { id: nextId.current++, role, text }])

  useEffect(() => {
    const offUpdate = window.hearth.agent.onUpdate((payload) => {
      const { update } = payload as { update: { type: string; text?: string } }
      if (update.type === 'message' && update.text) add('assistant', update.text)
      if (update.type === 'end') setBusy(false)
    })
    const offError = window.hearth.agent.onError((msg) => add('system', `agent error: ${msg}`))
    return () => {
      offUpdate()
      offError()
    }
  }, [])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    add('you', text)
    setInput('')
    setBusy(true)
    try {
      await window.hearth.agent.prompt(text)
    } catch (e) {
      add('system', `failed to send: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pb-4 pt-10 text-sm font-medium text-white/60">Chat</header>
      <div className="flex-1 space-y-3 overflow-y-auto px-6">
        {lines.map((l) => (
          <div key={l.id} className="text-sm">
            <span className="mr-2 text-white/35">{l.role}</span>
            <span className={l.role === 'system' ? 'text-amber-400' : 'text-white/90'}>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-white/8 p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={busy ? 'thinking…' : 'Ask Hearth to change itself…'}
          disabled={busy}
          className="flex-1 rounded-md bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30"
        />
        <button
          onClick={send}
          disabled={busy}
          className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  )
}
