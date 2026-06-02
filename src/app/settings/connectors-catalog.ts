// The six labeled connectors for guided setup. Hearth doesn't broker auth — it
// generates the right `mcp add` command for each backend and lets the CLI's own
// OAuth flow run (see CONNECTORS-PLAN.md). A connector gets a guided command ONLY
// when it has a verified first-party remote (Streamable-HTTP) MCP endpoint; where
// none is known we route to the persistent browser instead of fabricating a URL
// that would fail silently in the CLI.

import type { AgentKind } from '../../../electron/shared/protocol'

export interface GuidedConnector {
  id: string
  label: string
  /** Name the server lands under in CLI config — used to detect ✓/✗ presence. */
  serverName: string
  /** Verified first-party remote MCP endpoint. Absent => browser-login fallback. */
  url?: string
  /** Where "Open docs / Log in via browser" points. */
  site: string
}

export const GUIDED_CONNECTORS: GuidedConnector[] = [
  // Verified first-party remote MCP (OAuth handled by the CLI).
  { id: 'notion', label: 'Notion', serverName: 'notion', url: 'https://mcp.notion.com/mcp', site: 'https://www.notion.so' },
  // No verified first-party remote MCP endpoint — browser-login path. Fill `url`
  // here if/when a provider ships one (then it becomes a guided command for free).
  { id: 'google', label: 'Google Workspace', serverName: 'google', site: 'https://workspace.google.com' },
  { id: 'microsoft', label: 'Microsoft 365', serverName: 'microsoft', site: 'https://www.microsoft365.com' },
  { id: 'slack', label: 'Slack', serverName: 'slack', site: 'https://slack.com' },
  { id: 'fireflies', label: 'Fireflies', serverName: 'fireflies', site: 'https://app.fireflies.ai' },
  { id: 'granola', label: 'Granola', serverName: 'granola', site: 'https://www.granola.ai' },
]

/** The command(s) to register + authorize a connector for a backend. Claude pins
 * `-s user` (global) so it isn't scoped to one directory; Codex registers then
 * authorizes via a separate `mcp login`. Empty when the connector has no endpoint. */
export function addCommands(c: GuidedConnector, kind: AgentKind): string[] {
  if (!c.url) return []
  if (kind === 'codex') return [`codex mcp add ${c.serverName} --url ${c.url}`, `codex mcp login ${c.serverName}`]
  return [`claude mcp add --transport http -s user ${c.serverName} ${c.url}`]
}
