import { Icon } from '@/shell/Icon'

// Browser becomes real later in P4 (WebContentsView). Until then a faithful
// empty state keeps the tab set complete.

export function BrowserTab() {
  return (
    <div className="wb-empty">
      <Icon name="globe" />
      <h3>Browser</h3>
      <p>A real, persistent browser you (and the agent) can drive lands here.</p>
    </div>
  )
}
