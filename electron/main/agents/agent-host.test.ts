import { test, expect, describe } from 'bun:test'
import { AgentHost } from './agent-host.js'
import type { Agent, AgentKind, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

class StubAgent implements Agent {
  connectCalls = 0
  disposed = false
  sessions = 0
  private updates = new Set<(s: string, u: SessionUpdate) => void>()
  permission: ((s: string, r: PermissionRequest) => Promise<string>) | null = null

  constructor(
    readonly kind: AgentKind,
    private readonly failConnect = false,
  ) {}

  async connect(): Promise<void> {
    this.connectCalls++
    if (this.failConnect) throw new Error(`${this.kind} connect failed`)
  }
  async newSession(): Promise<AgentSession> {
    const id = `${this.kind}-${++this.sessions}`
    return {
      id,
      models: { available: [], current: null },
      modes: { available: [], current: null },
      configOptions: [],
      prompt: async () => {},
      setModel: async () => {},
      setMode: async () => {},
      setConfigOption: async () => {},
      cancel: async () => {},
      dispose: async () => {},
    }
  }
  onUpdate(cb: (s: string, u: SessionUpdate) => void): () => void {
    this.updates.add(cb)
    return () => this.updates.delete(cb)
  }
  onPermission(cb: (s: string, r: PermissionRequest) => Promise<string>): void {
    this.permission = cb
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
  emit(update: SessionUpdate): void {
    for (const h of this.updates) h('sess', update)
  }
}

function makeHost(failKinds: AgentKind[] = []) {
  const created: StubAgent[] = []
  const fail = new Set(failKinds)
  const host = new AgentHost((kind) => {
    const a = new StubAgent(kind, fail.has(kind))
    created.push(a)
    return a
  }, 'claude')
  return { host, created }
}

const msg = (text: string): SessionUpdate => ({ type: 'message', role: 'assistant', text })

describe('AgentHost', () => {
  test('connect builds and connects the initial backend', async () => {
    const { host, created } = makeHost()
    await host.connect()
    expect(host.kind).toBe('claude')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ kind: 'claude', connectCalls: 1 })
  })

  test('forwards updates from the current backend, and re-points on switch', async () => {
    const { host, created } = makeHost()
    const seen: string[] = []
    host.onUpdate((_s, u) => u.type === 'message' && seen.push(u.text))

    await host.connect()
    created[0].emit(msg('from-claude'))

    await host.switchTo('codex')
    created[0].emit(msg('claude-after-switch')) // old agent — must NOT forward
    created[1].emit(msg('from-codex'))

    expect(seen).toEqual(['from-claude', 'from-codex'])
  })

  test('permission handler is forwarded to whichever backend is current', async () => {
    const { host, created } = makeHost()
    host.onPermission(async () => 'allow')
    await host.connect()
    await host.switchTo('codex')
    const answer = await created[1].permission!('sess', { id: 'x', title: 't', options: [] })
    expect(answer).toBe('allow')
  })

  test('switching disposes the old backend and changes kind', async () => {
    const { host, created } = makeHost()
    await host.connect()
    await host.switchTo('codex')
    expect(host.kind).toBe('codex')
    expect(created[0].disposed).toBe(true)
    expect(created[1]).toMatchObject({ kind: 'codex', connectCalls: 1 })
  })

  test('reuses one session across prompts, and resets it on switch', async () => {
    const { host } = makeHost()
    const a = await host.prompt('one')
    const b = await host.prompt('two')
    expect(a).toBe('claude-1')
    expect(b).toBe('claude-1') // same session reused

    await host.switchTo('codex')
    const c = await host.prompt('three')
    expect(c).toBe('codex-1') // fresh session on the new backend
  })

  test('switching to the already-current backend is a no-op', async () => {
    const { host, created } = makeHost()
    await host.connect()
    await host.switchTo('claude')
    expect(created).toHaveLength(1)
  })

  test('a failed connect is not cached — a later attempt rebuilds', async () => {
    const { host, created } = makeHost(['claude'])
    await expect(host.connect()).rejects.toThrow('claude connect failed')
    // first agent failed; retry creates a fresh one
    await expect(host.connect()).rejects.toThrow('claude connect failed')
    expect(created.length).toBe(2)
  })
})
