import { Icon } from '@/shell/Icon'

// Files / Terminal / Browser become real in P4 (CodeMirror editor, node-pty +
// xterm, WebContentsView). Until then they show faithful empty states so the tab
// set is complete and the shell reads correctly.

export function FilesTab() {
  return (
    <div className="wb-empty">
      <Icon name="folder-open" />
      <h3>Files</h3>
      <p>An in-app editor for code and markdown lands here.</p>
    </div>
  )
}

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
