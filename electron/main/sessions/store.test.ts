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

test('create → append → list → get round-trips, persisting across instances', async () => {
  const s = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  expect(s.title).toBe('New session')
  expect(s.self).toBe(true)
  await store.append(s.id, [{ kind: 'user', text: 'hi' }])

  const reloaded = new SessionStore(dir, () => clock++)
  const list = await reloaded.list()
  expect(list).toHaveLength(1)
  expect(list[0].id).toBe(s.id)

  const detail = await reloaded.get(s.id)
  expect(detail?.entries).toHaveLength(1)
})

test('untouched sessions are hidden from list but retrievable, and swept on the next create', async () => {
  const empty = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  // Created but never prompted → not listed…
  expect(await store.list()).toHaveLength(0)
  // …but still directly retrievable while it's the active draft.
  expect((await store.get(empty.id))?.meta.id).toBe(empty.id)

  // A second create sweeps the abandoned empty off disk.
  const next = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  expect(await store.get(empty.id)).toBeNull()

  // Once prompted, a session appears in the list.
  await store.append(next.id, [{ kind: 'user', text: 'now it has content' }])
  expect((await store.list()).map((m) => m.id)).toEqual([next.id])
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
  await store.append(a.id, [{ kind: 'user', text: 'seed a' }]) // touch so the next create keeps it
  const b = await store.create({ workspaceId: 'ws', cwd: '/proj', self: false })
  await store.append(b.id, [{ kind: 'user', text: 'seed b' }])
  await store.append(a.id, [{ kind: 'user', text: 'later activity on a' }]) // a is now newest
  let list = await store.list()
  expect(list[0].id).toBe(a.id)

  await store.archive(b.id)
  list = await store.list()
  expect(list.map((m) => m.id)).toEqual([a.id])
})

test('search matches transcript content (not just title) and returns a snippet', async () => {
  const a = await store.create({ workspaceId: 'hearth', cwd: '/repo', self: true })
  await store.append(a.id, [
    { kind: 'user', text: 'hello world' },
    { kind: 'update', update: { type: 'message', role: 'assistant', text: 'the quail jumped over the fence' } },
  ])
  const b = await store.create({ workspaceId: 'ws', cwd: '/proj', self: false })
  await store.append(b.id, [{ kind: 'user', text: 'unrelated chatter' }])

  // "quail" appears only in a's body — title/workspace search would miss it.
  const hits = await store.search('quail')
  expect(hits.map((h) => h.meta.id)).toEqual([a.id])
  expect(hits[0].snippet).toContain('quail')

  // Empty query returns the full list.
  expect((await store.search('')).length).toBe(2)
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
