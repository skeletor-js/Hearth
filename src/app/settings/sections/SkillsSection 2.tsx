import { useEffect, useState } from 'react'
import type { SkillInfo } from '../../../../electron/main/skills/list'
import type { AvailableCommand } from '../../../../electron/shared/protocol'
import { SecLabel, Btn } from '../controls'

// Read-only discovery of Claude Code skills (global ~/.claude/skills + workspace).
// Hearth inherits them from the user's real config dir; this just surfaces them.
// Enabling/disabling means moving files — out of scope for v1.
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [commands, setCommands] = useState<AvailableCommand[]>([])

  useEffect(() => {
    void window.hearth.skills.list().then((r) => {
      setSkills(r.skills)
      setCommands(r.commands)
    })
  }, [])

  return (
    <>
      <SecLabel icon="sparkle">Skills</SecLabel>
      <p className="set-note">
        Skills your agent can invoke, discovered from <code>~/.claude/skills</code> and the workspace. Add or edit them
        as files, then reload.
      </p>

      <div className="list">
        {skills.length === 0 && <div className="list-empty">No skills found yet.</div>}
        {skills.map((s) => (
          <div key={s.path} className="list-row">
            <div className="list-main">
              <div className="list-title">
                {s.name} <span className="chip chip-sm">{s.scope}</span>
              </div>
              {s.description && <div className="list-meta">{s.description}</div>}
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
