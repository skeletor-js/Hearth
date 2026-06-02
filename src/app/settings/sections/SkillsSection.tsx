import { useEffect, useState } from 'react'
import type { SkillInfo } from '../../../../electron/main/skills/list'
import type { AvailableCommand } from '../../../../electron/shared/protocol'
import { SecLabel, Btn, Switch } from '../controls'

// Discovery + enable/disable of Claude Code skills (global ~/.claude/skills +
// workspace). Hearth inherits them from the user's real config dir. Toggling moves
// a skill between skills/ and skills-disabled/ so the agent stops/starts seeing it.
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [commands, setCommands] = useState<AvailableCommand[]>([])

  const load = () =>
    void window.hearth.skills.list().then((r) => {
      setSkills(r.skills)
      setCommands(r.commands)
    })
  useEffect(load, [])

  const toggle = (s: SkillInfo) => {
    // Optimistic flip; reload to pick up the moved path.
    setSkills((prev) => prev.map((x) => (x.path === s.path ? { ...x, enabled: !x.enabled } : x)))
    void window.hearth.skills.setEnabled(s.path, !s.enabled).then(load, load)
  }

  return (
    <>
      <SecLabel icon="sparkle">Skills</SecLabel>
      <p className="set-note">
        Skills your agent can invoke, discovered from <code>~/.claude/skills</code> and the workspace. Toggle one off to
        park it (the agent stops seeing it); add or edit them as files, then reload.
      </p>

      <div className="list">
        {skills.length === 0 && <div className="list-empty">No skills found yet.</div>}
        {skills.map((s) => (
          <div key={s.path} className={'list-row' + (s.enabled ? '' : ' is-off')}>
            <div className="list-main">
              <div className="list-title">
                {s.name} <span className="chip chip-sm">{s.scope}</span>
              </div>
              {s.description && <div className="list-meta">{s.description}</div>}
            </div>
            <div className="list-trailing">
              <Switch on={s.enabled} onChange={() => toggle(s)} />
            </div>
          </div>
        ))}
      </div>

      {commands.length > 0 && (
        <p className="set-note dim">
          Active commands this session: {commands.map((c) => c.name).join(', ')}
        </p>
      )}

      <Btn variant="ghost" icon="folder-open" onClick={() => void window.hearth.skills.reveal()}>
        Open skills folder
      </Btn>
    </>
  )
}
