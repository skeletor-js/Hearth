import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'dugite'
import { decideWorkspaceAction, ensureWorkspace } from './workspace.js'

describe('decideWorkspaceAction', () => {
  test('no repo yet → seed', () => {
    expect(decideWorkspaceAction({ exists: false, recordedVersion: null, currentVersion: '1.0.0' })).toBe('seed')
  })
  test('same version → reuse', () => {
    expect(decideWorkspaceAction({ exists: true, recordedVersion: '1.0.0', currentVersion: '1.0.0' })).toBe('reuse')
  })
  test('version bump → reseed', () => {
    expect(decideWorkspaceAction({ exists: true, recordedVersion: '1.0.0', currentVersion: '1.1.0' })).toBe('reseed')
  })
  test('missing recorded version on an existing repo → reseed', () => {
    expect(decideWorkspaceAction({ exists: true, recordedVersion: null, currentVersion: '1.0.0' })).toBe('reseed')
  })
})

const dirs: string[] = []
const scratch = (label: string) => {
  const d = mkdtempSync(join(tmpdir(), `hearth-ws-${label}-`))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const headCount = async (repo: string): Promise<number> => {
  const r = await exec(['rev-list', '--count', 'HEAD'], repo)
  return parseInt(r.stdout.trim(), 10)
}

describe('ensureWorkspace', () => {
  test('seed: copies source, symlinks node_modules, makes one baseline commit', async () => {
    const root = scratch('seed')
    const sourceDir = join(root, 'src-ship')
    const nm = join(root, 'nm-ship')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(nm, { recursive: true })
    writeFileSync(join(sourceDir, 'index.html'), '<html></html>')
    writeFileSync(join(nm, 'marker.txt'), 'dep')
    const workspaceDir = join(root, 'workspace')

    const result = await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: nm, version: '1.0.0' })

    expect(result).toBe(workspaceDir)
    expect(readFileSync(join(workspaceDir, 'index.html'), 'utf8')).toBe('<html></html>')
    expect(readFileSync(join(workspaceDir, '.hearth-workspace-version'), 'utf8').trim()).toBe('1.0.0')
    expect(lstatSync(join(workspaceDir, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(workspaceDir, 'node_modules', 'marker.txt'), 'utf8')).toBe('dep')
    expect(await headCount(workspaceDir)).toBe(1)
  })

  test('seed: a node_modules nested in source is not copied into the workspace', async () => {
    const root = scratch('skip-nm')
    const sourceDir = join(root, 'src-ship')
    mkdirSync(join(sourceDir, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(sourceDir, 'node_modules', 'dep', 'big.js'), 'x'.repeat(100))
    writeFileSync(join(sourceDir, 'index.html'), '<html></html>')
    const workspaceDir = join(root, 'workspace')
    const nm = join(root, 'nm-ship')
    mkdirSync(nm, { recursive: true })

    await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: nm, version: '1.0.0' })

    // node_modules is the symlink (to nm), not a copied directory of the source's deps.
    expect(lstatSync(join(workspaceDir, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(workspaceDir, 'node_modules', 'dep', 'big.js'))).toBe(false)
  })

  test('reuse: same version makes no new commit and preserves edits', async () => {
    const root = scratch('reuse')
    const sourceDir = join(root, 'src-ship')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'app.tsx'), 'v1')
    const workspaceDir = join(root, 'workspace')

    await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: null, version: '1.0.0' })
    // Simulate a user self-edit committed into the workspace.
    writeFileSync(join(workspaceDir, 'app.tsx'), 'user-edit')
    await exec(['commit', '-am', 'user edit'], workspaceDir)
    const before = await headCount(workspaceDir)

    await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: null, version: '1.0.0' })

    expect(await headCount(workspaceDir)).toBe(before) // no reseed
    expect(readFileSync(join(workspaceDir, 'app.tsx'), 'utf8')).toBe('user-edit') // edit kept
  })

  test('reseed: a version bump lays the new baseline over existing history', async () => {
    const root = scratch('reseed')
    const sourceDir = join(root, 'src-ship')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'app.tsx'), 'v1')
    const workspaceDir = join(root, 'workspace')

    await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: null, version: '1.0.0' })
    const afterSeed = await headCount(workspaceDir)

    // Ship a newer version with changed source.
    writeFileSync(join(sourceDir, 'app.tsx'), 'v2')
    await ensureWorkspace({ workspaceDir, sourceDir, nodeModulesDir: null, version: '2.0.0' })

    expect(readFileSync(join(workspaceDir, 'app.tsx'), 'utf8')).toBe('v2') // upgrade applied
    expect(readFileSync(join(workspaceDir, '.hearth-workspace-version'), 'utf8').trim()).toBe('2.0.0')
    expect(await headCount(workspaceDir)).toBe(afterSeed + 1) // history preserved + upgrade commit
  })
})
