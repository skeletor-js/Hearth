import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceRegistry } from './registry.js'

let dir: string
let reg: WorkspaceRegistry
const REPO = '/repo/hearth'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hearth-ws-'))
  reg = new WorkspaceRegistry(join(dir, 'workspaces.json'), REPO)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('always lists the built-in Hearth workspace first', async () => {
  const list = await reg.list()
  expect(list).toHaveLength(1)
  expect(list[0]).toEqual({ id: 'hearth', name: 'Hearth', path: REPO, isHearth: true })
})

test('adds a user folder and persists it', async () => {
  const ws = await reg.add('/Users/jordan/dev/ledger-api')
  expect(ws.name).toBe('ledger-api')
  expect(ws.isHearth).toBe(false)

  const reloaded = new WorkspaceRegistry(join(dir, 'workspaces.json'), REPO)
  const list = await reloaded.list()
  expect(list.map((w) => w.name)).toEqual(['Hearth', 'ledger-api'])
})

test('adding the same path twice is idempotent', async () => {
  const a = await reg.add('/x/proj')
  const b = await reg.add('/x/proj')
  expect(a.id).toBe(b.id)
  expect((await reg.list()).filter((w) => !w.isHearth)).toHaveLength(1)
})

test('adding the repo root returns the built-in Hearth workspace', async () => {
  const ws = await reg.add(REPO)
  expect(ws.id).toBe('hearth')
  expect((await reg.list())).toHaveLength(1)
})

test('removes a user folder but never Hearth', async () => {
  const ws = await reg.add('/x/proj')
  await reg.remove(ws.id)
  expect(await reg.list()).toHaveLength(1)

  await reg.remove('hearth')
  expect(await reg.list()).toHaveLength(1)
})
