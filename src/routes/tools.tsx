import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import type { MicroAppInfo } from '../../electron/main/micro-apps/server'

export const Route = createFileRoute('/tools')({ component: ToolsScreen })

// Tools = the micro-apps you've built. Each is a standalone little app embedded
// in a sandboxed frame. Built from chat via "Save as tool", or scaffolded directly.
function ToolsScreen() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<MicroAppInfo[] | null>(null)

  useEffect(() => {
    void window.hearth.microApps.list().then(setApps)
  }, [])

  const open = (name: string) => void navigate({ to: '/micro/$name', params: { name } })

  return (
    <div className="screen scroll" data-screen-label="Tools">
      <div className="screen-inner narrow">
        <div className="screen-head">
          <span className="screen-head-ic">
            <Icon name="squares-four" className="ico-20" />
          </span>
          <h1 className="screen-title">Tools</h1>
        </div>
        <p className="screen-sub">
          The little apps you’ve built — each one a self-contained tool that stays put. Make a new one from any chat with
          “Save as tool”.
        </p>

        <div className="sec" style={{ marginTop: 18 }}>
          {apps === null ? null : apps.length === 0 ? (
            <div className="wb-empty" style={{ minHeight: 200 }}>
              <Icon name="squares-four" />
              <h3>No tools yet</h3>
              <p>In a Hearth session, ask for what you need, then hit “Save as tool” to keep it.</p>
            </div>
          ) : (
            <div className="tile-grid">
              {apps.map((a) => (
                <div className="card-row click" key={a.name} style={{ marginBottom: 0 }} onClick={() => open(a.name)}>
                  <span className="cr-mark">
                    <Icon name="squares-four" fill={a.running} />
                  </span>
                  <div className="cr-body">
                    <div className="cr-title">{a.name}</div>
                    <div className="cr-sub">{a.running ? 'Running' : 'Idle — opens on click'}</div>
                  </div>
                  <Icon name="arrow-right" style={{ color: 'var(--faint)' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
