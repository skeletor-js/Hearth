import { createFileRoute } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'

// Placeholder — the Home / New-session screen is built in P3.
export const Route = createFileRoute('/new')({ component: NewScreen })

function NewScreen() {
  return (
    <div className="screen scroll">
      <div className="wb-empty" style={{ minHeight: '70vh' }}>
        <Icon name="circle-dashed" />
        <h3>New session</h3>
        <p>Coming in a later phase.</p>
      </div>
    </div>
  )
}
