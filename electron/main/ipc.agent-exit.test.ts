// U5: adapter death must settle pending permission resolvers (no leak, the
// agent-side promise completes) and broadcast agent:error ATTRIBUTED to the
// dying turn's session — not whatever session is foreground.
//
// `electron` / node-pty / the overlay client are mock.module'd as in
// ipc.turn-lifecycle.test.ts; ipc.js is imported with a ?u5 query so this file
// gets its own module instance bound to THIS file's mocks even when another
// test file already evaluated ipc.js against its own electron mock.
import { test, expect, describe, beforeEach, mock } from 'bun:test'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const sent: Array<{ channel: string; payload: unknown }> = []

mock.module('electron', () => ({
  app: { on: () => {}, getPath: () => '/tmp', getVersion: () => '0.0.0-test' },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}))
mock.module('./terminal/pty.js', () => ({
  TerminalManager: class {
    disposeAll() {}
  },
}))
mock.module('./self-mod/overlay-client.js', () => ({
  createOverlayClient: () => ({
    pin: async () => {},
    apply: async () => {},
    release: async () => {},
    turnStart: async () => {},
    turnEnd: async () => {},
  }),
}))

const { registerIpc, HEARTH_CHANNELS } = await import('./ipc.js?u5')
type Services = Parameters<typeof registerIpc>[0]

function makeServices() {
  let permissionHandler: ((sessionId: string, req: unknown) => Promise<string>) | null = null
  let exitHandler: ((sessionKeys: string[], message: string) => void) | null = null
  const host = {
    kind: 'claude',
    onUpdate: () => {},
    onPermission: (cb: typeof permissionHandler) => (permissionHandler = cb),
    onAgentExit: (cb: typeof exitHandler) => {
      exitHandler = cb
      return () => {}
    },
    onModelsChanged: () => {},
    onModeChanged: () => {},
    onConfigChanged: () => {},
    onUsageChanged: () => {},
    onCommandsChanged: () => {},
  }
  const services = {
    repoRoot: '/repo',
    host,
    selfMod: {},
    sessions: {},
    workspaces: {},
    browser: {},
    window: { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } },
    secrets: {},
    mcp: {},
    capabilities: {},
    broker: {},
    routines: {},
    scheduler: {},
    updater: {},
  } as unknown as Services
  return {
    services,
    askPermission: (sessionId: string, req: unknown) => permissionHandler!(sessionId, req),
    fireExit: (keys: string[], message: string) => exitHandler!(keys, message),
  }
}

beforeEach(() => {
  handlers.clear()
  sent.length = 0
})

describe('agent exit handling in ipc (U5)', () => {
  test('a pending permission settles when the agent dies — the ask promise completes', async () => {
    const { services, askPermission, fireExit } = makeServices()
    registerIpc(services)

    const ask = askPermission('bg-session', { id: 'perm-1', title: 'Run a command', options: [] })
    let settled = false
    const result = ask.then(
      () => ((settled = true), 'resolved'),
      () => ((settled = true), 'rejected'),
    )
    await new Promise((r) => setTimeout(r, 1))
    expect(settled).toBe(false) // genuinely pending until the death

    fireExit(['bg-session'], 'agent process exited unexpectedly with code 9')
    expect(await result).toBe('rejected')
  })

  test('agent:error is broadcast per dying session key', () => {
    const { services, fireExit } = makeServices()
    registerIpc(services)

    fireExit(['routine-1'], 'agent process exited unexpectedly (SIGKILL)')
    const errors = sent.filter((s) => s.channel === HEARTH_CHANNELS.agentError)
    expect(errors).toEqual([
      {
        channel: HEARTH_CHANNELS.agentError,
        payload: { sessionKey: 'routine-1', message: 'agent process exited unexpectedly (SIGKILL)' },
      },
    ])
  })

  test('an idle death (no in-flight turns) broadcasts one global error', () => {
    const { services, fireExit } = makeServices()
    registerIpc(services)

    fireExit([], 'agent process exited unexpectedly with code 1')
    const errors = sent.filter((s) => s.channel === HEARTH_CHANNELS.agentError)
    expect(errors).toHaveLength(1)
    expect((errors[0].payload as { sessionKey: string | null }).sessionKey).toBeNull()
  })

  test('answered permissions are unaffected by a later death', async () => {
    const { services, askPermission, fireExit } = makeServices()
    registerIpc(services)

    const ask = askPermission('s1', { id: 'perm-2', title: 't', options: [] })
    const respond = handlers.get(HEARTH_CHANNELS.permissionRespond)!
    respond(null, { id: 'perm-2', optionId: 'allow-1' })
    expect(await ask).toBe('allow-1')

    fireExit(['s1'], 'died') // nothing left to settle — must not throw
  })
})
