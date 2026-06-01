import { createFileRoute } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'

// Placeholder — Search over the session store is built in P3.
export const Route = createFileRoute('/search')({ component: SearchScreen })

function SearchScreen() {
  return (
    <div className="screen scroll">
      <div className="wb-empty" style={{ minHeight: '70vh' }}>
        <Icon name="magnifying-glass" />
        <h3>Search</h3>
        <p>Coming in a later phase.</p>
      </div>
    </div>
  )
}
