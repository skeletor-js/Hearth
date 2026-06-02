import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills } from './list.js'

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
})
