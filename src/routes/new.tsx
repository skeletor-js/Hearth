import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { AsciiEmber } from '@/shell/Mascot'
import { startSession, openSession } from '@/app/sessions'
import type { Workspace } from '../../electron/main/workspaces/registry'
import type { SessionMeta } from '../../electron/main/sessions/store'

export const Route = createFileRoute('/new')({ component: HomeScreen })

const STARTERS: [string, string, string][] = [
  ['flame', 'Evolve Hearth', 'Ask Hearth to change its own UI, prompts, or skills.'],
  ['folder-open', 'Work in a folder', 'Point a session at a project and start building.'],
  ['lightbulb', 'Explore an idea', 'Think something through with your agent.'],
  ['list-bullets', 'Plan a build', 'Sketch a plan with Hearth, then build it step by step.'],
]

function HomeScreen() {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recent, setRecent] = useState<SessionMeta[]>([])

  useEffect(() => {
    void window.hearth.workspaces.list().then(setWorkspaces)
    void window.hearth.sessions.list().then((l) => setRecent(l.slice(0, 6)))
  }, [])

  const hearth = workspaces.find((w) => w.isHearth)
  const go = () => void navigate({ to: '/chat' })

  const start = async (ws?: Workspace) => {
    const target = ws ?? hearth
    if (!target) return
    await startSession(target)
    go()
  }
  const openFolder = async () => {
    const ws = await window.hearth.workspaces.open()
    if (ws) await start(ws)
  }
  const resume = (m: SessionMeta) => {
    openSession(m)
    go()
  }

  return (
    <div className="screen scroll" data-screen-label="Home">
      <div className="screen-inner">
        <div className="hero">
          <AsciiEmber fontSize={16} />
          <h1>What are we building?</h1>
          <p>One ongoing relationship with your coding agent — it keeps the repo, the plan, and how you like to work.</p>
          <div className="hero-grid">
            {STARTERS.map((c, i) => (
              <div className="hero-card" key={i} onClick={i === 1 ? openFolder : () => start()}>
                <div className="hc-t">
                  <Icon name={c[0]} fill={c[0] === 'flame'} /> {c[1]}
                </div>
                <div className="hc-s">{c[2]}</div>
              </div>
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div className="sec">
            <div className="sec-label">
              <Icon name="clock-counter-clockwise" /> Continue
            </div>
            {recent.map((m) => (
              <div className="card-row click" key={m.id} onClick={() => resume(m)}>
                <span className="cr-mark">
                  <Icon name={m.self ? 'flame' : 'chat-circle'} fill={m.self} />
                </span>
                <div className="cr-body">
                  <div className="cr-title">{m.title}</div>
                  <div className="cr-sub">{m.self ? 'Hearth' : m.cwd}</div>
                </div>
                <Icon name="arrow-right" style={{ color: 'var(--faint)' }} />
              </div>
            ))}
          </div>
        )}

        <div className="sec">
          <div className="sec-label">
            <Icon name="stack" /> Workspaces
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={openFolder}>
              <Icon name="folder-simple-plus" /> Open folder
            </button>
          </div>
          <div className="tile-grid">
            {workspaces.map((w) => (
              <div className="card-row click" key={w.id} style={{ marginBottom: 0 }} onClick={() => start(w)}>
                <span className="cr-mark">
                  <Icon name={w.isHearth ? 'flame' : 'git-branch'} fill={w.isHearth} />
                </span>
                <div className="cr-body">
                  <div className="cr-title">{w.name}</div>
                  <div className="cr-sub">{w.path}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
