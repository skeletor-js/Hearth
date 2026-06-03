import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldMicroApp, listStarters } from './scaffold'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hearth-scaffold-'))
  // Minimal base template.
  const base = join(root, 'templates', 'micro-app', 'src')
  mkdirSync(base, { recursive: true })
  writeFileSync(join(root, 'templates', 'micro-app', 'package.json'), '{"name":"{{name}}"}')
  writeFileSync(join(root, 'templates', 'micro-app', 'index.html'), '<title>{{name}}</title>')
  writeFileSync(join(base, 'App.tsx'), 'export default function App() { return null } // {{name}}')
  // One starter that overlays App.tsx.
  const starter = join(root, 'templates', 'starters', 'tracker')
  mkdirSync(starter, { recursive: true })
  writeFileSync(join(starter, 'App.tsx'), 'export default function App() { return "TRACKER" }')
  writeFileSync(join(starter, 'starter.json'), JSON.stringify({ title: 'Tracker', description: 'desc' }))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listStarters', () => {
  test('lists the blank starter first, then discovered ones', () => {
    const s = listStarters(root)
    expect(s[0].id).toBe('')
    expect(s.map((x) => x.id)).toContain('tracker')
    expect(s.find((x) => x.id === 'tracker')?.title).toBe('Tracker')
  })
})

describe('scaffoldMicroApp', () => {
  test('blank scaffold fills the name placeholder', () => {
    const r = scaffoldMicroApp(root, 'my-app')
    expect(r.name).toBe('my-app')
    expect(readFileSync(join(r.dir, 'package.json'), 'utf-8')).toContain('"name":"my-app"')
    expect(readFileSync(join(r.dir, 'src', 'App.tsx'), 'utf-8')).toContain('// my-app')
  })

  test('a starter overlays its App.tsx', () => {
    const r = scaffoldMicroApp(root, 'tracked', 'tracker')
    expect(readFileSync(join(r.dir, 'src', 'App.tsx'), 'utf-8')).toBe('export default function App() { return "TRACKER" }')
  })

  test('an unknown starter is rejected', () => {
    expect(() => scaffoldMicroApp(root, 'x', '../escape')).toThrow('Unknown starter')
    expect(() => scaffoldMicroApp(root, 'y', 'nope')).toThrow('Unknown starter')
  })

  test('a duplicate name is rejected', () => {
    scaffoldMicroApp(root, 'dup')
    expect(() => scaffoldMicroApp(root, 'dup')).toThrow('Already exists')
  })
})
