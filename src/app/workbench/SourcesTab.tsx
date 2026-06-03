import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { toast } from '@/shell/toast'
import { useSession } from '../session-store'
import { GUIDED_CONNECTORS } from '../settings/connectors-catalog'
import type { ActiveConnector, AgentKind } from '../../../electron/shared/protocol'

// Sources: the knowledge-worker view onto connected tools. Hearth doesn't broker
// connector data (those MCP servers belong to the agent), so this surface shows
// real connection *status* and hands cross-source digests to the agent — which
// reads the data through its own tools. No data is fetched or faked here.

const label = (name: string) => GUIDED_CONNECTORS.find((c) => c.serverName === name)?.label ?? name

const DIGEST_PROMPT =
  'Give me a quick digest of what has happened today across my connected tools ' +
  '(calendar, email, Slack, meeting notes — whatever is connected). Group it by source, ' +
  'keep it skimmable, and cite specifics (names, times, links) where you can.'

export function SourcesTab() {
  const navigate = useNavigate()
  const active = useSession((s) => s.active)
  const [connectors, setConnectors] = useState<ActiveConnector[] | null>(null)

  useEffect(() => {
    let live = true
    void window.hearth.agent.getBackend().then(async (backend: AgentKind) => {
      const a = await window.hearth.mcp.active(active?.cwd)
      if (live) setConnectors(backend === 'codex' ? a.codex : a.claude)
    })
    return () => {
      live = false
    }
  }, [active?.cwd])

  const ask = (text: string) => {
    useSession.getState().requestPrompt(text)
    toast('Asked your agent — see the reply in chat')
  }

  if (connectors === null) return <div className="wb-pad" />

  if (connectors.length === 0) {
    return (
      <div className="wb-empty">
        <Icon name="broadcast" />
        <h3>No sources connected</h3>
        <p>Connect Slack, Gmail, Calendar, Notion, or your meeting notes to pull them together here.</p>
        <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} onClick={() => void navigate({ to: '/settings' })}>
          <Icon name="plugs-connected" /> Connect a source
        </button>
      </div>
    )
  }

  return (
    <div className="wb-pad">
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', height: 36 }} onClick={() => ask(DIGEST_PROMPT)}>
        <Icon name="sparkle" fill /> Compile today’s digest
      </button>
      <p className="src-note">
        Pulls from the sources below through your agent. The reply lands in chat.
      </p>

      <div className="src-list">
        {connectors.map((c) => (
          <div key={c.name} className="card-row" style={{ marginBottom: 0 }}>
            <span className="cr-mark">
              <Icon name="plug" fill />
            </span>
            <div className="cr-body">
              <div className="cr-title">{label(c.name)}</div>
              <div className="cr-sub">
                {c.scope === 'user' ? 'Connected' : `Connected · ${c.scope}`}
                {c.hasAuth ? ' · authed' : ''}
              </div>
            </div>
            <button
              className="btn btn-sm btn-quiet"
              title={`Ask about ${label(c.name)}`}
              onClick={() => ask(`Summarize what's new in ${label(c.name)} today — the highlights I should know about.`)}
            >
              <Icon name="arrow-right" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
