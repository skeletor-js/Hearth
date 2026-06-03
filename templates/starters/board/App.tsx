import { useEffect, useState } from 'react'

type Col = 'todo' | 'doing' | 'done'
interface Card {
  id: string
  text: string
  col: Col
}

const COLS: { id: Col; title: string }[] = [
  { id: 'todo', title: 'Todo' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
]
const ORDER: Col[] = ['todo', 'doing', 'done']
const KEY = 'board.cards'

function load(): Card[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export default function App() {
  const [cards, setCards] = useState<Card[]>(load)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(cards))
  }, [cards])

  const add = () => {
    const t = draft.trim()
    if (!t) return
    setCards((p) => [...p, { id: crypto.randomUUID(), text: t, col: 'todo' }])
    setDraft('')
  }
  const move = (id: string, dir: -1 | 1) =>
    setCards((p) =>
      p.map((c) => {
        if (c.id !== id) return c
        const i = ORDER.indexOf(c.col) + dir
        return i < 0 || i >= ORDER.length ? c : { ...c, col: ORDER[i] }
      }),
    )
  const remove = (id: string) => setCards((p) => p.filter((c) => c.id !== id))

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Board</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, maxWidth: 420 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New card…"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={add} style={{ padding: '9px 14px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer' }}>
          Add
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {COLS.map((col) => {
          const mine = cards.filter((c) => c.col === col.id)
          return (
            <div key={col.id} style={{ background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: 10, padding: 10, minHeight: 160 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                {col.title} · {mine.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mine.map((c) => (
                  <div key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 9px', fontSize: 13 }}>
                    <div style={{ marginBottom: 6 }}>{c.text}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => move(c.id, -1)} disabled={c.col === 'todo'} style={nav}>
                        ←
                      </button>
                      <button onClick={() => move(c.id, 1)} disabled={c.col === 'done'} style={nav}>
                        →
                      </button>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => remove(c.id)} style={{ ...nav, color: '#94a3b8' }} title="Remove">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const nav: React.CSSProperties = { border: '1px solid #e2e8f0', background: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }
