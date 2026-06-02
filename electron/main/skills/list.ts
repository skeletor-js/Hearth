// Discovery + enable/disable for Claude Code skills. Skills are folders containing
// a SKILL.md with YAML frontmatter (name + description); they live globally in
// ~/.claude/skills and per-project in <workspace>/.claude/skills. Hearth inherits
// them because it uses the user's real config dir.
//
// Claude Code discovers skills from disk, so "disabling" one means moving its
// folder out of the discovery path: Hearth parks it in a sibling `skills-disabled/`
// and moves it back to re-enable. Disabled skills are still surfaced here (with
// enabled:false) so the UI can toggle them. See docs/V2-PACKAGING-PLAN.md (WS3).

import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs'

/** Folder under `.claude` holding active skills (Claude Code discovers these). */
const ENABLED_DIR = 'skills'
/** Sibling folder where Hearth parks disabled skills (out of the discovery path). */
const DISABLED_DIR = 'skills-disabled'

export interface SkillInfo {
  name: string
  description: string
  scope: 'global' | 'workspace'
  /** Absolute path to the skill's folder. */
  path: string
  /** False when the skill is parked in skills-disabled/ (not seen by the agent). */
  enabled: boolean
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

function readDir(dir: string, scope: SkillInfo['scope'], enabled: boolean): SkillInfo[] {
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
        enabled,
      })
    } catch {
      // Unreadable entry — skip it rather than fail the whole listing.
    }
  }
  return out
}

/** Active + parked skills under a `.claude` dir, tagged with scope and enabled. */
function scopeSkills(claudeDir: string, scope: SkillInfo['scope']): SkillInfo[] {
  return [
    ...readDir(join(claudeDir, ENABLED_DIR), scope, true),
    ...readDir(join(claudeDir, DISABLED_DIR), scope, false),
  ]
}

/** Skills discovered globally and (optionally) in a workspace, name-sorted. */
export function listSkills(workspaceCwd?: string): SkillInfo[] {
  const global = scopeSkills(join(homedir(), '.claude'), 'global')
  const workspace = workspaceCwd ? scopeSkills(join(workspaceCwd, '.claude'), 'workspace') : []
  return [...global, ...workspace].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Enable or disable a skill by moving its folder between `skills/` and
 * `skills-disabled/` under the same `.claude` dir. Returns the new folder path.
 * Guarded: refuses to move anything that isn't already inside one of those two
 * folders, so a bad path can't relocate arbitrary directories.
 */
export function setSkillEnabled(skillPath: string, enabled: boolean): string {
  const name = basename(skillPath)
  const container = dirname(skillPath)
  const currentKind = basename(container)
  if (currentKind !== ENABLED_DIR && currentKind !== DISABLED_DIR) {
    throw new Error(`refusing to toggle a skill outside a skills folder: ${skillPath}`)
  }
  const claudeDir = dirname(container)
  const destContainer = join(claudeDir, enabled ? ENABLED_DIR : DISABLED_DIR)
  const dest = join(destContainer, name)
  if (resolve(dest) === resolve(skillPath)) return skillPath // already in desired state
  mkdirSync(destContainer, { recursive: true })
  renameSync(skillPath, dest)
  return dest
}

/** The global skills folder path (for the "Reveal folder" action). */
export function globalSkillsDir(): string {
  return join(homedir(), '.claude', 'skills')
}
