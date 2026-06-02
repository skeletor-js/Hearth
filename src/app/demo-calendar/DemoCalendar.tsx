import { useState } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 12 }, (_, i) => i + 7) // 7am - 6pm

const MOCK_EVENTS = [
  { day: 1, start: 9, duration: 1, title: 'Standup', color: 'var(--accent)' },
  { day: 1, start: 13, duration: 2, title: 'Design review', color: '#6366f1' },
  { day: 2, start: 10, duration: 1.5, title: 'Sprint planning', color: '#f59e0b' },
  { day: 3, start: 9, duration: 1, title: 'Standup', color: 'var(--accent)' },
  { day: 3, start: 14, duration: 1, title: '1:1 with Alex', color: '#10b981' },
  { day: 4, start: 11, duration: 1, title: 'Lunch & learn', color: '#ec4899' },
  { day: 4, start: 15, duration: 2, title: 'Deep work block', color: '#8b5cf6' },
  { day: 5, start: 9, duration: 1, title: 'Standup', color: 'var(--accent)' },
  { day: 5, start: 16, duration: 1, title: 'Retro', color: '#f59e0b' },
]

export function DemoCalendar() {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek)
    d.setDate(startOfWeek.getDate() + i)
    return d
  })

  return (
    <div style={{ padding: '1.5rem', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
          {today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>
        <span style={{ color: 'var(--faint)', fontSize: '0.85rem' }}>Week view (demo)</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3.5rem repeat(7, 1fr)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {/* Header row */}
        <div style={{ borderBottom: '1px solid var(--border)', padding: '0.5rem' }} />
        {weekDates.map((date, i) => {
          const isToday = date.toDateString() === today.toDateString()
          return (
            <div
              key={i}
              onClick={() => setSelectedDay(selectedDay === i ? null : i)}
              style={{
                borderBottom: '1px solid var(--border)',
                borderLeft: '1px solid var(--border)',
                padding: '0.5rem',
                textAlign: 'center',
                cursor: 'pointer',
                background: selectedDay === i ? 'var(--hover)' : isToday ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
              }}
            >
              <div style={{ fontSize: '0.7rem', color: 'var(--faint)', textTransform: 'uppercase' }}>
                {DAYS[i]}
              </div>
              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? 'var(--accent)' : undefined,
                }}
              >
                {date.getDate()}
              </div>
            </div>
          )
        })}

        {/* Time grid */}
        {HOURS.map((hour) => (
          <div key={hour} style={{ display: 'contents' }}>
            <div
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.7rem',
                color: 'var(--faint)',
                textAlign: 'right',
                borderTop: '1px solid var(--border)',
                height: '3.5rem',
              }}
            >
              {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'pm' : 'am'}
            </div>
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const event = MOCK_EVENTS.find((e) => e.day === dayIdx && e.start === hour)
              return (
                <div
                  key={dayIdx}
                  style={{
                    borderTop: '1px solid var(--border)',
                    borderLeft: '1px solid var(--border)',
                    height: '3.5rem',
                    position: 'relative',
                  }}
                >
                  {event && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: 2,
                        right: 2,
                        height: `calc(${event.duration * 3.5}rem - 4px)`,
                        background: event.color,
                        borderRadius: '0.25rem',
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        color: '#fff',
                        overflow: 'hidden',
                        zIndex: 1,
                      }}
                    >
                      {event.title}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
