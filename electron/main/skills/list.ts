// Read-only discovery of Claude Code skills. Skills are folders containing a
// SKILL.md with YAML frontmatter (name + description); they live globally in
// ~/.claude/skills and per-project in <workspace>/.claude/skills. Hearth inherits
// them because it uses the user's real config dir — this just surfaces what's
// there. v1 is discovery only: enabling/disabling a skill means moving files,
// which is out of scope (see docs/SETTINGS-AND-AUTH-PLAN.md).

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'

export interface SkillInfo {
  name: string
  description: string
  scope: 'global' | 'workspace'
  /** Absolute path to the skill's folder. */
  path: string
}

/** Pull `name`/`description` out of a SKILL.md YAML frontmatter block. */
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const field = (key: string): string | undefined => {
    const f = m[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return f ? f[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  return { name: field('name'), description: field('description') }
}

function readDir(dir: string, scope: SkillInfo['scope']): SkillInfo[] {
  if (!existsSync(dir)) return []
  const out: SkillInfo[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const entry of entries) {
    const skillDir = join(dir, entry)
    const skillMd = join(skillDir, 'SKILL.md')
    try {
      if (!statSync(skillDir).isDirectory() || !existsSync(skillMd)) continue
      const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'))
      out.push({
        name: fm.name || entry,
        description: fm.description || '',
        scope,
        path: skillDir,
      })
    } catch {
      // Unreadable entry — skip it rather than fail the whole listing.
    }
  }
  return out
}

/** Skills discovered globally and (optionally) in a workspace, name-sorted. */
export function listSkills(workspaceCwd?: string): SkillInfo[] {
  const global = readDir(join(homedir(), '.claude', 'skills'), 'global')
  const workspace = workspaceCwd ? readDir(join(workspaceCwd, '.claude', 'skills'), 'workspace') : []
  return [...global, ...workspace].sort((a, b) => a.name.localeCompare(b.name))
}

/** The global skills folder path (for the "Reveal folder" action). */
export function globalSkillsDir(): string {
  return join(homedir(), '.claude', 'skills')
}
