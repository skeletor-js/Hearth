import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile as fsReadFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDir, readFile, writeFile } from './files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hearth-fs-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('writeFile', () => {
  test('creates missing parent dirs (e.g. .hearth/)', async () => {
    await writeFile(root, '.hearth/scratchpad.md', 'hello')
    const back = await fsReadFile(join(root, '.hearth', 'scratchpad.md'), 'utf8')
    expect(back).toBe('hello')
  })

  test('round-trips through readFile', async () => {
    await writeFile(root, '.hearth/scratchpad.md', '# notes\n- a')
    const fc = await readFile(root, '.hearth/scratchpad.md')
    expect(fc.content).toBe('# notes\n- a')
    expect(fc.readonly).toBe(false)
  })

  test('rejects paths escaping the workspace', async () => {
    await expect(writeFile(root, '../escape.md', 'x')).rejects.toThrow('path escapes workspace')
  })
})

describe('listDir', () => {
  test('omits .hearth from the tree', async () => {
    await mkdir(join(root, '.hearth'), { recursive: true })
    await writeFile(root, '.hearth/scratchpad.md', 'notes')
    await writeFile(root, 'visible.md', 'x')
    const entries = await listDir(root)
    const names = entries.map((e) => e.name)
    expect(names).toContain('visible.md')
    expect(names).not.toContain('.hearth')
  })
})
