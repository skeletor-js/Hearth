import { Icon } from '@/shell/Icon'

// Terminal / Browser become real later in P4 (node-pty + xterm, WebContentsView).
// Until then they show faithful empty states so the tab set is complete.

export function TerminalTab() {
  return (
    <div className="wb-empty">
      <Icon name="terminal-window" />
      <h3>Terminal</h3>
      <p>An interactive shell scoped to the workspace lands here.</p>
    </div>
  )
}

export function BrowserTab() {
  return (
    <div className="wb-empty">
      <Icon name="globe" />
      <h3>Browser</h3>
      <p>A real, persistent browser you (and the agent) can drive lands here.</p>
    </div>
  )
}
