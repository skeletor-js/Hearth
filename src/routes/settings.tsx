import { createFileRoute } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'

// Placeholder — full Settings is built in P5.
export const Route = createFileRoute('/settings')({ component: SettingsScreen })

function SettingsScreen() {
  return (
    <div className="screen scroll">
      <div className="wb-empty" style={{ minHeight: '70vh' }}>
        <Icon name="gear" />
        <h3>Settings</h3>
        <p>Coming in a later phase.</p>
      </div>
    </div>
  )
}
