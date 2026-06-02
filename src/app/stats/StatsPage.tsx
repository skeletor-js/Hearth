const cards = [
  { label: 'Users', value: '12,847', change: '+14.2%' },
  { label: 'Revenue', value: '$84,320', change: '+8.7%' },
  { label: 'Growth', value: '23.5%', change: '+3.1%' },
]

export function StatsPage() {
  return (
    <div style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '0.25rem' }}>Stats</h1>
      <p style={{ color: 'var(--faint)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Overview of key metrics.
      </p>

      <div style={{ display: 'flex', gap: '1rem' }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              background: 'var(--surface, rgba(255,255,255,0.04))',
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              borderRadius: 12,
              padding: '1.25rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--faint)', marginBottom: '0.5rem' }}>
              {c.label}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              {c.value}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#22c55e' }}>{c.change}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
