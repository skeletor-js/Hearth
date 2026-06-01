import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from './store.js'

let dir: string
let clock: number
let store: SessionStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hearth-sess-'))
  clock = 1_000
  store = new SessionStore(dir, () => clock++)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('create → list → get round-trips, persisting across instances', async () => {
  const s = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  expect(s.title).toBe('New session')
  expect(s.self).toBe(true)

  const reloaded = new SessionStore(dir, () => clock++)
  const list = await reloaded.list()
  expect(list).toHaveLength(1)
  expect(list[0].id).toBe(s.id)

  const detail = await reloaded.get(s.id)
  expect(detail?.entries).toEqual([])
})

test('append persists the raw stream and auto-titles from the first user line', async () => {
  const s = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  await store.append(s.id, [
    { kind: 'user', text: 'Add a command palette to Hearth' },
    { kind: 'update', update: { type: 'message', role: 'assistant', text: 'On it' } },
    { kind: 'update', update: { type: 'end', stopReason: 'end_turn' } },
  ])

  const detail = await store.get(s.id)
  expect(detail?.entries).toHaveLength(3)
  expect(detail?.entries[1]).toEqual({ kind: 'update', update: { type: 'message', role: 'assistant', text: 'On it' } })
  expect(detail?.meta.title).toBe('Add a command palette to Hearth')
})

test('list is newest-activity first and hides archived', async () => {
  const a = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  const b = await store.create({ workspaceId: 'ws', cwd: '/proj', self: false })
  await store.append(a.id, [{ kind: 'user', text: 'later activity on a' }]) // bumps a's updatedAt
  let list = await store.list()
  expect(list[0].id).toBe(a.id)

  await store.archive(b.id)
  list = await store.list()
  expect(list.map((m) => m.id)).toEqual([a.id])
})

test('rename, duplicate, and remove', async () => {
  const s = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  await store.append(s.id, [{ kind: 'user', text: 'hello' }])

  await store.rename(s.id, 'Renamed')
  expect((await store.get(s.id))?.meta.title).toBe('Renamed')

  const copy = await store.duplicate(s.id)
  expect(copy?.title).toBe('Renamed (copy)')
  expect((await store.get(copy!.id))?.entries).toHaveLength(1)

  await store.remove(s.id)
  expect(await store.get(s.id)).toBeNull()
  expect((await store.list()).map((m) => m.id)).toEqual([copy!.id])
})
