import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { toast } from '@/shell/toast'
import type { Routine, RoutineSchedule } from '../../electron/shared/protocol'
import type { Workspace } from '../../electron/main/workspaces/registry'

export const Route = createFileRoute('/routines')({ component: RoutinesScreen })

interface RoutinePreset {
  title: string
  prompt: string
  schedule: RoutineSchedule
}

// Canonical starting points. The morning brief is the headline routine: it pulls
// the day together from whatever sources are connected, through the agent.
const ROUTINE_PRESETS: RoutinePreset[] = [
  {
    title: 'Morning brief',
    prompt:
      'Give me my morning brief. Pull together today from my connected tools: calendar (what meetings I have and ' +
      'anything I need to prep), email and Slack (what needs a reply or my attention), and recent meeting notes ' +
      '(open follow-ups). Keep it tight and skimmable, grouped by source, with the 3 things that matter most up top.',
    schedule: { type: 'daily', time: '08:00' },
  },
  {
    title: 'End-of-day wrap',
    prompt:
      'Wrap up my day: what got done, what slipped, and what is on deck for tomorrow based on my calendar and any ' +
      'open threads in email and Slack. End with a short prioritized list for tomorrow morning.',
    schedule: { type: 'daily', time: '17:00' },
  },
]

function scheduleLabel(s: RoutineSchedule): string {
  return s.type === 'daily' ? `Every day at ${s.time}` : `Every ${s.everyMinutes} min`
}
function when(at: number | null): string {
  if (!at) return '—'
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function RoutinesScreen() {
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [adding, setAdding] = useState<{ preset?: RoutinePreset } | null>(null)

  const reload = () => void window.hearth.routines.list().then(setRoutines)
  useEffect(() => {
    reload()
    void window.hearth.workspaces.list().then(setWorkspaces)
  }, [])

  const toggle = async (r: Routine) => {
    await window.hearth.routines.setEnabled(r.id, !r.enabled)
    reload()
  }
  const runNow = async (r: Routine) => {
    await window.hearth.routines.runNow(r.id)
    toast(`Running “${r.title}” now`)
    reload()
  }
  const remove = async (r: Routine) => {
    await window.hearth.routines.remove(r.id)
    reload()
  }

  return (
    <div className="screen scroll" data-screen-label="Routines">
      <div className="screen-inner narrow">
        <div className="screen-head">
          <span className="screen-head-ic">
            <Icon name="clock-clockwise" className="ico-20" />
          </span>
          <h1 className="screen-title">Routines</h1>
        </div>
        <p className="screen-sub">
          Standing tasks your agent runs on a schedule — a morning brief, a daily digest. They run while Hearth is open;
          the reply lands in chat.
        </p>

        <div className="sec" style={{ marginTop: 18 }}>
          <div className="sec-label">
            <Icon name="clock-clockwise" /> Your routines
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" onClick={() => setAdding({})}>
              <Icon name="plus" /> New routine
            </button>
          </div>

          {!adding && (
            <div className="routine-presets">
              {ROUTINE_PRESETS.map((p) => (
                <button key={p.title} className="routine-preset" onClick={() => setAdding({ preset: p })}>
                  <Icon name="sparkle" fill />
                  <span>{p.title}</span>
                  <span className="routine-preset-sub">{scheduleLabel(p.schedule)}</span>
                </button>
              ))}
            </div>
          )}

          {adding && (
            <RoutineForm
              workspaces={workspaces}
              preset={adding.preset}
              onCancel={() => setAdding(null)}
              onCreated={() => {
                setAdding(null)
                reload()
              }}
            />
          )}

          {routines === null ? null : routines.length === 0 && !adding ? (
            <div className="wb-empty" style={{ minHeight: 160 }}>
              <Icon name="clock-clockwise" />
              <h3>No routines yet</h3>
              <p>Create one to have your agent run a standing task on a schedule.</p>
            </div>
          ) : (
            routines.map((r) => (
              <div className="card-row" key={r.id} style={{ alignItems: 'flex-start' }}>
                <span className="cr-mark">
                  <Icon name="clock-clockwise" fill={r.enabled} />
                </span>
                <div className="cr-body">
                  <div className="cr-title">{r.title}</div>
                  <div className="cr-sub">
                    {scheduleLabel(r.schedule)}
                    {r.enabled ? ` · next ${when(r.nextRunAt)}` : ' · paused'}
                    {r.lastRunAt ? ` · last ${when(r.lastRunAt)}` : ''}
                  </div>
                </div>
                <button className="btn btn-sm btn-quiet" title="Run now" onClick={() => void runNow(r)}>
                  <Icon name="play" />
                </button>
                <button className="btn btn-sm btn-quiet" title={r.enabled ? 'Pause' : 'Resume'} onClick={() => void toggle(r)}>
                  <Icon name={r.enabled ? 'pause' : 'play-circle'} />
                </button>
                <button className="btn btn-sm btn-quiet" title="Delete" onClick={() => void remove(r)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function RoutineForm({
  workspaces,
  preset,
  onCancel,
  onCreated,
}: {
  workspaces: Workspace[]
  preset?: RoutinePreset
  onCancel: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState(preset?.title ?? '')
  const [prompt, setPrompt] = useState(preset?.prompt ?? '')
  const [type, setType] = useState<'daily' | 'interval'>(preset?.schedule.type ?? 'daily')
  const [time, setTime] = useState(preset?.schedule.type === 'daily' ? preset.schedule.time : '08:00')
  const [everyMinutes, setEveryMinutes] = useState(preset?.schedule.type === 'interval' ? preset.schedule.everyMinutes : 60)
  // Default a knowledge workspace (where connected sources live) when one exists.
  const [wsId, setWsId] = useState((workspaces.find((w) => !w.isHearth) ?? workspaces[0])?.id ?? '')

  const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0]
  const canSave = title.trim() && prompt.trim() && ws

  const save = async () => {
    if (!ws) return
    const schedule: RoutineSchedule = type === 'daily' ? { type: 'daily', time } : { type: 'interval', everyMinutes }
    try {
      await window.hearth.routines.create({ title, prompt, schedule, workspaceId: ws.id, cwd: ws.path })
      onCreated()
    } catch (e) {
      toast(`Couldn’t create routine: ${String(e)}`)
    }
  }

  return (
    <div className="routine-form">
      <input className="field" placeholder="Title (e.g. Morning brief)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="field"
        placeholder="What should the agent do? (e.g. Summarize my calendar, Slack, and inbox for today.)"
        value={prompt}
        rows={3}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="routine-form-row">
        <select className="field" value={type} onChange={(e) => setType(e.target.value as 'daily' | 'interval')}>
          <option value="daily">Every day at</option>
          <option value="interval">Every N minutes</option>
        </select>
        {type === 'daily' ? (
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        ) : (
          <input
            className="field"
            type="number"
            min={1}
            value={everyMinutes}
            onChange={(e) => setEveryMinutes(Math.max(1, Number(e.target.value) || 1))}
          />
        )}
        <select className="field" value={wsId} onChange={(e) => setWsId(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="routine-form-actions">
        <button className="btn btn-sm btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={!canSave} onClick={() => void save()}>
          <Icon name="check" /> Create routine
        </button>
      </div>
    </div>
  )
}
