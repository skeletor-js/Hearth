import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, setSkillEnabled } from './list.js'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hearth-skills-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function writeSkill(root: string, dirName: string, frontmatter: string) {
  const skillDir = join(root, '.claude', 'skills', dirName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), frontmatter)
}

describe('listSkills', () => {
  test('parses name + description from frontmatter and tags workspace scope', () => {
    const ws = tmp()
    writeSkill(ws, 'my-skill', '---\nname: My Skill\ndescription: Does a thing\n---\n\nbody')
    const skills = listSkills(ws)
    const mine = skills.find((s) => s.name === 'My Skill')
    expect(mine).toBeTruthy()
    expect(mine?.description).toBe('Does a thing')
    expect(mine?.scope).toBe('workspace')
  })

  test('falls back to the folder name when frontmatter lacks a name', () => {
    const ws = tmp()
    writeSkill(ws, 'no-name', '---\ndescription: x\n---\n')
    expect(listSkills(ws).some((s) => s.name === 'no-name')).toBe(true)
  })

  test('ignores folders without SKILL.md', () => {
    const ws = tmp()
    mkdirSync(join(ws, '.claude', 'skills', 'empty'), { recursive: true })
    expect(listSkills(ws).some((s) => s.name === 'empty')).toBe(false)
  })

  test('handles a missing skills dir without throwing', () => {
    expect(() => listSkills(tmp())).not.toThrow()
  })

  test('strips surrounding quotes from frontmatter values', () => {
    const ws = tmp()
    writeSkill(ws, 'q', '---\nname: "Quoted"\ndescription: \'Single\'\n---\n')
    const s = listSkills(ws).find((x) => x.name === 'Quoted')
    expect(s?.description).toBe('Single')
  })

  test('skills in skills/ are enabled', () => {
    const ws = tmp()
    writeSkill(ws, 'on', '---\nname: On\n---\n')
    expect(listSkills(ws).find((s) => s.name === 'On')?.enabled).toBe(true)
  })

  test('skills parked in skills-disabled/ are surfaced as disabled', () => {
    const ws = tmp()
    const d = join(ws, '.claude', 'skills-disabled', 'off')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'SKILL.md'), '---\nname: Off\n---\n')
    const found = listSkills(ws).find((s) => s.name === 'Off')
    expect(found?.enabled).toBe(false)
  })
})

describe('setSkillEnabled', () => {
  test('disable then re-enable moves the folder and flips enabled', () => {
    const ws = tmp()
    writeSkill(ws, 'movable', '---\nname: Movable\n---\n')
    const before = listSkills(ws).find((s) => s.name === 'Movable')!
    expect(before.enabled).toBe(true)

    const disabledPath = setSkillEnabled(before.path, false)
    expect(existsSync(before.path)).toBe(false)
    expect(existsSync(disabledPath)).toBe(true)
    expect(listSkills(ws).find((s) => s.name === 'Movable')?.enabled).toBe(false)

    const enabledPath = setSkillEnabled(disabledPath, true)
    expect(enabledPath).toBe(before.path)
    expect(listSkills(ws).find((s) => s.name === 'Movable')?.enabled).toBe(true)
  })

  test('a no-op toggle (already in desired state) returns the same path', () => {
    const ws = tmp()
    writeSkill(ws, 'stay', '---\nname: Stay\n---\n')
    const s = listSkills(ws).find((x) => x.name === 'Stay')!
    expect(setSkillEnabled(s.path, true)).toBe(s.path)
  })

  test('refuses to move a path outside a skills folder', () => {
    const ws = tmp()
    const stray = join(ws, 'not-a-skill')
    mkdirSync(stray, { recursive: true })
    expect(() => setSkillEnabled(stray, false)).toThrow()
  })
})
