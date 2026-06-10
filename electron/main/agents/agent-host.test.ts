import { test, expect, describe } from 'bun:test'
import { AgentHost, AgentDiedError } from './agent-host.js'
import type { Agent, AgentExitInfo, AgentKind, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

class StubAgent implements Agent {
  connectCalls = 0
  disposed = false
  sessions = 0
  private updates = new Set<(s: string, u: SessionUpdate) => void>()
  private exits = new Set<(info: AgentExitInfo) => void>()
  permission: ((s: string, r: PermissionRequest) => Promise<string>) | null = null
  /** When set, session.prompt awaits this (a hung in-flight turn for exit tests). */
  promptGate: Promise<void> | null = null
  /** When set, newSession awaits this (a death during slow session/new). */
  sessionGate: Promise<void> | null = null

  constructor(
    readonly kind: AgentKind,
    private readonly failConnect = false,
  ) {}

  async connect(): Promise<void> {
    this.connectCalls++
    if (this.failConnect) throw new Error(`${this.kind} connect failed`)
  }
  async newSession(): Promise<AgentSession> {
    if (this.sessionGate) await this.sessionGate
    const id = `${this.kind}-${++this.sessions}`
    return {
      id,
      models: { available: [], current: null },
      modes: { available: [], current: null },
      configOptions: [],
      prompt: async () => {
        if (this.promptGate) await this.promptGate
      },
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
  onExit(cb: (info: AgentExitInfo) => void): () => void {
    this.exits.add(cb)
    return () => this.exits.delete(cb)
  }
  triggerExit(info: AgentExitInfo = { code: 1, signal: null }): void {
    for (const h of this.exits) h(info)
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

describe('AgentHost adapter death (U5)', () => {
  const never = new Promise<void>(() => {})

  test('mid-turn death rejects the in-flight prompt with AgentDiedError, attributed to its session', async () => {
    const { host, created } = makeHost()
    await host.connect()
    created[0].promptGate = never
    const turn = host.prompt('streaming…', { key: 'bg-routine' })
    await new Promise((r) => setTimeout(r, 1))
    created[0].triggerExit({ code: 9, signal: null })

    const err = await turn.catch((e) => e)
    expect(err).toBeInstanceOf(AgentDiedError)
    expect((err as AgentDiedError).sessionKey).toBe('bg-routine')
    expect((err as Error).message).toContain('code 9')
    expect(host.isConnected()).toBe(false)
  })

  test('the exit event carries the in-flight session keys, not the foreground one', async () => {
    const { host, created } = makeHost()
    const seen: Array<{ keys: string[]; message: string }> = []
    host.onAgentExit((keys, message) => seen.push({ keys, message }))

    await host.prompt('done turn', { key: 'foreground' }) // completes — not in flight
    created[0].promptGate = never
    const bg = host.prompt('hung turn', { key: 'background' })
    await new Promise((r) => setTimeout(r, 1))
    created[0].triggerExit()

    await bg.catch(() => {})
    expect(seen).toHaveLength(1)
    expect(seen[0].keys).toEqual(['background'])
  })

  test('the next prompt after a death reconnects a fresh agent (no dead cache)', async () => {
    const { host, created } = makeHost()
    await host.connect()
    created[0].promptGate = never
    const dying = host.prompt('x', { key: 's1' })
    await new Promise((r) => setTimeout(r, 1))
    created[0].triggerExit()
    await dying.catch(() => {})

    const id = await host.prompt('retry', { key: 's1' })
    expect(created).toHaveLength(2)
    expect(created[1].connectCalls).toBe(1)
    expect(id).toBe('claude-1') // a fresh session on the fresh agent
  })

  test('death during session creation (slow session/new) still rejects the turn', async () => {
    const { host, created } = makeHost()
    await host.connect()
    created[0].sessionGate = never // session/new spawning the CLI takes seconds
    const turn = host.prompt('x', { key: 'starting-up' })
    await new Promise((r) => setTimeout(r, 1))
    created[0].triggerExit({ code: null, signal: 'SIGKILL' })

    const err = await turn.catch((e) => e)
    expect(err).toBeInstanceOf(AgentDiedError)
    expect((err as AgentDiedError).sessionKey).toBe('starting-up')
  })

  test('a deliberate backend switch never fires the exit event', async () => {
    const { host, created } = makeHost()
    const seen: string[][] = []
    host.onAgentExit((keys) => seen.push(keys))
    await host.connect()
    await host.switchTo('codex')
    created[0].triggerExit() // stale agent firing late — must be ignored
    expect(seen).toEqual([])
  })
})
