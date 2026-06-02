import { useState } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MOCK_EVENTS: Record<string, string[]> = {
  '2026-06-02': ['Team standup', 'Design review'],
  '2026-06-05': ['Sprint planning'],
  '2026-06-10': ['1:1 with Jordan'],
  '2026-06-12': ['Demo day'],
  '2026-06-15': ['Retro'],
  '2026-06-18': ['Lunch meetup', 'Code review'],
  '2026-06-20': ['Release prep'],
  '2026-06-25': ['All hands'],
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function DemoCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState<string | null>(null)

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate())

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(year - 1) }
    else setMonth(month - 1)
  }
  const next = () => {
    if (month === 11) { setMonth(0); setYear(year + 1) }
    else setMonth(month + 1)
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const selectedEvents = selected ? MOCK_EVENTS[selected] ?? [] : []

  return (
    <div style={{ padding: '2rem', maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '0.25rem' }}>Calendar</h1>
      <p style={{ color: 'var(--faint)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        A mock calendar demo page.
      </p>

      <div style={{
        background: 'var(--surface, rgba(255,255,255,0.04))',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        padding: '1.25rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <button onClick={prev} style={navBtn}>&larr;</button>
          <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={next} style={navBtn}>&rarr;</button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {DAYS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--faint)', padding: '4px 0', fontWeight: 500 }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />
            const key = dateKey(year, month, day)
            const isToday = key === todayKey
            const isSelected = key === selected
            const hasEvents = !!MOCK_EVENTS[key]
            return (
              <button
                key={key}
                onClick={() => setSelected(isSelected ? null : key)}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: isSelected ? '1.5px solid var(--accent, #6366f1)' : '1px solid transparent',
                  background: isToday
                    ? 'var(--accent, #6366f1)'
                    : isSelected
                      ? 'rgba(99,102,241,0.12)'
                      : 'transparent',
                  color: isToday ? '#fff' : 'inherit',
                  fontWeight: isToday ? 700 : 400,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {day}
                {hasEvents && (
                  <span style={{
                    position: 'absolute',
                    bottom: 4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: isToday ? '#fff' : 'var(--accent, #6366f1)',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Events panel */}
      {selected && (
        <div style={{
          marginTop: '1rem',
          background: 'var(--surface, rgba(255,255,255,0.04))',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderRadius: 12,
          padding: '1rem 1.25rem',
        }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--faint)', marginBottom: '0.5rem' }}>
            {selected}
          </div>
          {selectedEvents.length === 0 ? (
            <div style={{ color: 'var(--faint)', fontSize: '0.85rem' }}>No events</div>
          ) : (
            selectedEvents.map((ev) => (
              <div key={ev} style={{
                padding: '0.4rem 0.6rem',
                marginBottom: 4,
                borderRadius: 6,
                background: 'rgba(99,102,241,0.1)',
                fontSize: '0.85rem',
              }}>
                {ev}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: '0.9rem',
}
