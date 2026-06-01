import { useEffect, useRef, useState } from 'react'
import type { PermissionRequest, SessionUpdate } from '../../../electron/shared/protocol'
import { PermissionPrompt } from './PermissionPrompt'

// A rendered turn is a flat list of entries. Tool calls update in place (keyed by
// their tool id); assistant message chunks coalesce into one bubble; thoughts and
// diffs append. This is the file the agent itself rewrites when you ask it to
// change the chat UI — it's deliberately small and self-contained.
type Entry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'thought'; id: number; text: string }
  | { kind: 'tool'; id: number; toolId: string; title: string; status: 'pending' | 'running' | 'done' | 'error' }
  | { kind: 'diff'; id: number; path: string; added: number; removed: number }
  | { kind: 'system'; id: number; text: string }

const STATUS_GLYPH = { pending: '○', running: '◐', done: '●', error: '✕' } as const
const STATUS_COLOR = {
  pending: 'text-white/40',
  running: 'text-sky-300',
  done: 'text-emerald-300',
  error: 'text-red-400',
} as const

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function ChatApp() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const nextId = useRef(0)
  // Whether the last assistant entry is still open for coalescing message chunks.
  const openAssistant = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const id = () => nextId.current++

  // Apply one streamed update to the entry list.
  const apply = (update: SessionUpdate) =>
    setEntries((prev) => {
      switch (update.type) {
        case 'message': {
          if (openAssistant.current) {
            const last = prev[prev.length - 1]
            if (last?.kind === 'assistant') {
              return [...prev.slice(0, -1), { ...last, text: last.text + update.text }]
            }
          }
          openAssistant.current = true
          return [...prev, { kind: 'assistant', id: id(), text: update.text }]
        }
        case 'thought':
          openAssistant.current = false
          return [...prev, { kind: 'thought', id: id(), text: update.text }]
        case 'tool-call': {
          openAssistant.current = false
          const idx = prev.findIndex((e) => e.kind === 'tool' && e.toolId === update.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...(next[idx] as Extract<Entry, { kind: 'tool' }>), title: update.title, status: update.status }
            return next
          }
          return [...prev, { kind: 'tool', id: id(), toolId: update.id, title: update.title, status: update.status }]
        }
        case 'diff': {
          openAssistant.current = false
          const removed = update.oldText ? countLines(update.oldText) : 0
          const added = countLines(update.newText)
          return [...prev, { kind: 'diff', id: id(), path: update.path, added, removed }]
        }
        case 'end':
          openAssistant.current = false
          return prev
      }
    })

  useEffect(() => {
    const offUpdate = window.hearth.agent.onUpdate(({ update }) => {
      apply(update)
      if (update.type === 'end') setBusy(false)
    })
    const offError = window.hearth.agent.onError((msg) => {
      openAssistant.current = false
      setEntries((p) => [...p, { kind: 'system', id: id(), text: `agent error: ${msg}` }])
      setBusy(false)
    })
    const offPermission = window.hearth.permission.onRequest(({ req }) => setPermission(req))
    return () => {
      offUpdate()
      offError()
      offPermission()
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, permission])

  const answer = (optionId: string) => {
    if (!permission) return
    window.hearth.permission.respond(permission.id, optionId)
    setPermission(null)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    openAssistant.current = false
    setEntries((p) => [...p, { kind: 'user', id: id(), text }])
    setInput('')
    setBusy(true)
    try {
      await window.hearth.agent.prompt(text)
    } catch (e) {
      setEntries((p) => [...p, { kind: 'system', id: id(), text: `failed to send: ${String(e)}` }])
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pb-4 pt-10 text-sm font-medium text-white/60">Chat</header>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-6">
        {entries.map((e) => (
          <EntryView key={e.id} entry={e} />
        ))}
        {permission && (
          <div className="pt-1">
            <PermissionPrompt request={permission} onAnswer={answer} />
          </div>
        )}
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

function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="text-sm">
          <span className="mr-2 text-white/35">you</span>
          <span className="text-white/90">{entry.text}</span>
        </div>
      )
    case 'assistant':
      return <div className="whitespace-pre-wrap text-sm text-white/90">{entry.text}</div>
    case 'thought':
      return <div className="border-l border-white/10 pl-3 text-xs italic text-white/40">{entry.text}</div>
    case 'tool':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className={STATUS_COLOR[entry.status]}>{STATUS_GLYPH[entry.status]}</span>
          <span className="text-white/70">{entry.title}</span>
        </div>
      )
    case 'diff':
      return (
        <div className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1 font-mono text-xs">
          <span className="text-white/60">{entry.path}</span>
          {entry.added > 0 && <span className="text-emerald-400">+{entry.added}</span>}
          {entry.removed > 0 && <span className="text-red-400">-{entry.removed}</span>}
        </div>
      )
    case 'system':
      return <div className="text-sm text-amber-400">{entry.text}</div>
  }
}
