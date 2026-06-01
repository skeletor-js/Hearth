import { useRef } from 'react'

// Drag-to-resize handle. axis "x" → horizontal (columns), "y" → vertical (rows).
// Calls onResize(delta) with incremental movement on each pointermove.
export function Resizer({
  axis,
  onResize,
  className = '',
}: {
  axis: 'x' | 'y'
  onResize: (delta: number) => void
  className?: string
}) {
  const last = useRef(0)
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    last.current = axis === 'x' ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => {
      const cur = axis === 'x' ? ev.clientX : ev.clientY
      onResize(cur - last.current)
      last.current = cur
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }
  return <div className={`resizer resizer-${axis} ${className}`} onPointerDown={onDown} />
}
