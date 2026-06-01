import { useEffect, useState, type CSSProperties } from 'react'

// Hearth's flame mark (Phosphor flame glyph).
export function FlameMark({
  size = 19,
  fill = true,
  className = '',
  style,
}: {
  size?: number
  fill?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <i className={`ph-${fill ? 'fill' : 'thin'} ph-flame ${className}`} style={{ fontSize: size, ...style }} />
  )
}

// Animated ASCII ember — flame tongues flickering over a glowing bed.
const EMBER_FRAMES = [
  [' (   ', '  ) )', ' ( ( )', '( ) ) '],
  ['  )  ', ' ( ( ', ') ) ( ', ' ( ) )'],
  [' ( ) ', '  ) ( ', ' ( ) )', ') ( ) '],
  ['  (  ', ' ) ) (', '( ( ) ', ' ) ( )'],
]

export function AsciiEmber({
  fontSize = 15,
  paused = false,
  className = '',
}: {
  fontSize?: number
  paused?: boolean
  className?: string
}) {
  const [f, setF] = useState(0)
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setF((v) => (v + 1) % EMBER_FRAMES.length), 220)
    return () => clearInterval(id)
  }, [paused])
  const frame = EMBER_FRAMES[f]
  return (
    <div className={`ember ${className}`} style={{ fontSize, lineHeight: 1.0 }} aria-hidden="true">
      <div className="glow">
        {frame.map((row, i) => (
          <div key={i} style={{ opacity: 0.55 + i * 0.15 }}>
            {row}
          </div>
        ))}
        <div style={{ opacity: 0.85, letterSpacing: '1px' }}>≋≋≋≋≋</div>
      </div>
    </div>
  )
}

// Inline "thinking" flame + label + typing dots.
export function ThinkingEmber({ label = 'Hearth is thinking' }: { label?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--t-12)', color: 'var(--subtle)' }}>
      <i className="ph-fill ph-flame thinking-flame" style={{ color: 'var(--accent)', fontSize: 'var(--t-14)' }} />
      <span>{label}</span>
      <span className="typing">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}
