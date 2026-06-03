import { useEffect, useState } from 'react'

type Status = 'todo' | 'doing' | 'done'
interface Item {
  id: string
  text: string
  status: Status
}

const NEXT: Record<Status, Status> = { todo: 'doing', doing: 'done', done: 'todo' }
const LABEL: Record<Status, string> = { todo: 'Todo', doing: 'Doing', done: 'Done' }
const COLOR: Record<Status, string> = { todo: '#94a3b8', doing: '#f59e0b', done: '#22c55e' }
const KEY = 'tracker.items'

function load(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export default function App() {
  const [items, setItems] = useState<Item[]>(load)
  const [text, setText] = useState('')

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items))
  }, [items])

  const add = () => {
    const t = text.trim()
    if (!t) return
    setItems((p) => [...p, { id: crypto.randomUUID(), text: t, status: 'todo' }])
    setText('')
  }
  const cycle = (id: string) => setItems((p) => p.map((i) => (i.id === id ? { ...i, status: NEXT[i.status] } : i)))
  const remove = (id: string) => setItems((p) => p.filter((i) => i.id !== id))

  const counts = items.reduce<Record<Status, number>>(
    (a, i) => ({ ...a, [i.status]: a[i.status] + 1 }),
    { todo: 0, doing: 0, done: 0 },
  )

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Tracker</h1>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        {counts.todo} todo · {counts.doing} doing · {counts.done} done
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add an item…"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={add} style={btn}>
          Add
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Nothing yet. Add your first item above.</p>}
        {items.map((i) => (
          <div
            key={i.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid #eef2f6', borderRadius: 8 }}
          >
            <button
              onClick={() => cycle(i.id)}
              title="Click to advance"
              style={{ ...pill, background: COLOR[i.status] }}
            >
              {LABEL[i.status]}
            </button>
            <span style={{ flex: 1, textDecoration: i.status === 'done' ? 'line-through' : 'none', color: i.status === 'done' ? '#94a3b8' : '#0f172a' }}>
              {i.text}
            </span>
            <button onClick={() => remove(i.id)} style={ghost} title="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { padding: '9px 14px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', fontSize: 14, cursor: 'pointer' }
const pill: React.CSSProperties = { border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 9px', cursor: 'pointer', minWidth: 54 }
const ghost: React.CSSProperties = { border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }
