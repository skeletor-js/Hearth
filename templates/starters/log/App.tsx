import { useEffect, useState } from 'react'

interface Entry {
  id: string
  text: string
  at: number
}

const KEY = 'log.entries'

function load(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function when(at: number): string {
  const d = new Date(at)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>(load)
  const [text, setText] = useState('')

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(entries))
  }, [entries])

  const add = () => {
    const t = text.trim()
    if (!t) return
    setEntries((p) => [{ id: crypto.randomUUID(), text: t, at: Date.now() }, ...p])
    setText('')
  }
  const remove = (id: string) => setEntries((p) => p.filter((e) => e.id !== id))

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Log</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Record a note or decision…"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={add} style={{ padding: '9px 14px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer' }}>
          Add
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>No entries yet.</p>}
        {entries.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap', paddingTop: 1, minWidth: 96 }}>{when(e.at)}</span>
            <span style={{ flex: 1, fontSize: 14, whiteSpace: 'pre-wrap' }}>{e.text}</span>
            <button onClick={() => remove(e.id)} style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }} title="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
