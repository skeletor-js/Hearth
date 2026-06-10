import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { toToolSlug } from '@/app/chat/SaveAsTool'
import type { MicroAppInfo } from '../../electron/main/micro-apps/server'
import type { StarterInfo } from '../../electron/main/micro-apps/scaffold'
import { scaffoldTool } from '@/app/scaffold-tool'

export const Route = createFileRoute('/tools')({ component: ToolsScreen })

// Tools = the micro-apps you've built. Each is a standalone little app embedded
// in a sandboxed frame. Built from chat via "Save as tool", or from a starter here.
function ToolsScreen() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<MicroAppInfo[] | null>(null)
  const [starters, setStarters] = useState<StarterInfo[]>([])
  const [picking, setPicking] = useState<StarterInfo | null>(null)
  const [name, setName] = useState('')

  const reload = () => void window.hearth.microApps.list().then(setApps)
  useEffect(() => {
    reload()
    void window.hearth.microApps.starters().then(setStarters)
  }, [])

  const open = (n: string) => void navigate({ to: '/micro/$name', params: { name: n } })

  const create = async () => {
    const slug = toToolSlug(name)
    if (!picking || !slug) return
    if (!(await scaffoldTool(slug, picking.id || undefined))) return
    setPicking(null)
    setName('')
    open(slug)
  }

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
          The little apps you’ve built — each a self-contained tool that stays put. Start one from a template below, or
          from any chat with “Save as tool”.
        </p>

        <div className="sec" style={{ marginTop: 18 }}>
          <div className="sec-label">
            <Icon name="plus" /> New from a template
          </div>
          <div className="tile-grid">
            {starters.map((s) => (
              <div
                key={s.id || 'blank'}
                className={'card-row click' + (picking?.id === s.id ? ' on' : '')}
                style={{ marginBottom: 0 }}
                onClick={() => {
                  setPicking(s)
                  setName('')
                }}
              >
                <span className="cr-mark">
                  <Icon name={s.id ? 'squares-four' : 'plus'} />
                </span>
                <div className="cr-body">
                  <div className="cr-title">{s.title}</div>
                  <div className="cr-sub">{s.description}</div>
                </div>
              </div>
            ))}
          </div>

          {picking && (
            <div className="save-tool-row open" style={{ marginTop: 12 }}>
              <input
                className="field"
                autoFocus
                placeholder={`Name your ${picking.title.toLowerCase()}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                  else if (e.key === 'Escape') setPicking(null)
                }}
              />
              <span className="save-tool-slug">
                {toToolSlug(name) ? `micro-apps/${toToolSlug(name)}` : 'lowercase letters, numbers, - or _'}
              </span>
              <button className="btn btn-sm btn-quiet" onClick={() => setPicking(null)}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" disabled={!toToolSlug(name)} onClick={() => void create()}>
                <Icon name="check" /> Create
              </button>
            </div>
          )}
        </div>

        <div className="sec">
          <div className="sec-label">
            <Icon name="squares-four" /> Your tools
          </div>
          {apps === null ? null : apps.length === 0 ? (
            <div className="wb-empty" style={{ minHeight: 160 }}>
              <Icon name="squares-four" />
              <h3>No tools yet</h3>
              <p>Pick a template above, or ask in a Hearth session and hit “Save as tool”.</p>
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
