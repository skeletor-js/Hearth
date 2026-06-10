import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile as fsReadFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDir, readFile, writeFile, writeFileGuarded, ProtectedPathError, PROTECTED_WRITE_MESSAGE } from './files'

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

// U4: the IPC fsWrite path hard-denies the scope guard's blocked/protected
// tiers when the workspace IS the Hearth repo — the Files tab and
// eval_js → files.write writes both land here, so the UI can't be the gate.
describe('writeFileGuarded', () => {
  let other: string
  beforeEach(async () => {
    other = await mkdtemp(join(tmpdir(), 'hearth-ws-'))
  })
  afterEach(async () => {
    await rm(other, { recursive: true, force: true })
  })

  test('denies a protected-island write on the Hearth repo', async () => {
    // `root` stands in for the Hearth repo root (the guard keys on root === repoRoot).
    await expect(
      writeFileGuarded(root, root, 'electron/main/self-mod/boot-watchdog.ts', 'sabotage'),
    ).rejects.toThrow(PROTECTED_WRITE_MESSAGE)
  })

  test('denies a .claude write on the Hearth repo', async () => {
    await expect(writeFileGuarded(root, root, '.claude/settings.json', '{}')).rejects.toThrow(
      PROTECTED_WRITE_MESSAGE,
    )
  })

  test('denies a blocked-tier secrets write on the Hearth repo', async () => {
    await expect(writeFileGuarded(root, root, '.env', 'KEY=1')).rejects.toThrow(PROTECTED_WRITE_MESSAGE)
  })

  test('the rejection is typed and carries the offending path', async () => {
    const err = await writeFileGuarded(root, root, '.claude/settings.json', '{}').catch((e) => e)
    expect(err).toBeInstanceOf(ProtectedPathError)
    expect((err as ProtectedPathError).code).toBe('protected-path')
    expect((err as Error).message).toContain('.claude/settings.json')
  })

  test('allows a canvas write on the Hearth repo', async () => {
    await writeFileGuarded(root, root, 'src/app/chat/ChatView.tsx', '// edit')
    const back = await fsReadFile(join(root, 'src', 'app', 'chat', 'ChatView.tsx'), 'utf8')
    expect(back).toBe('// edit')
  })

  test('the same island-shaped path under a DIFFERENT workspace is allowed', async () => {
    await writeFileGuarded(other, root, 'electron/main/self-mod/boot-watchdog.ts', 'not hearth')
    const back = await fsReadFile(join(other, 'electron', 'main', 'self-mod', 'boot-watchdog.ts'), 'utf8')
    expect(back).toBe('not hearth')
  })

  test('a case-variant repo root still triggers the guard (macOS case-insensitive fs)', async () => {
    await expect(
      writeFileGuarded(root.toUpperCase(), root, '.claude/settings.json', '{}'),
    ).rejects.toThrow(PROTECTED_WRITE_MESSAGE)
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
