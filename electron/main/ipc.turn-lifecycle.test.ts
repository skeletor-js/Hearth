// Characterization tests for the agentPrompt turn lifecycle (audit U3).
// These pin the CURRENT ordering invariants of the ipc.ts god handler before
// U13 extracts it into a TurnCoordinator — they assert what the code does
// today, quirks included, so the refactor is provably behavior-preserving.
//
// The handler is driven unmodified: `electron`, the pty manager (native
// node-pty is built for Electron's ABI, not bun's), and the overlay client
// (fire-and-forget HTTP) are replaced via mock.module; every self-mod /
// host / session boundary records into one shared call log so ordering is
// asserted across all of them at once.
//
// Note: runTracker.beginRun/endRun are internal to registerIpc and not
// directly observable — beginRun is pinned via its immediate neighbor
// selfMod.beginTurn, endRun via its observable effects (overlay.apply + the
// lane-clearing selfModActivity broadcast).
import { test, expect, describe, beforeEach, mock } from 'bun:test'

interface Sent {
  channel: string
  payload: unknown
}

const log: string[] = []
const sent: Sent[] = []

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
    create() {}
    write() {}
    resize() {}
    kill() {}
    disposeAll() {}
  },
}))
mock.module('./self-mod/overlay-client.js', () => ({
  createOverlayClient: () => ({
    pin: async (path: string) => void log.push(`overlay.pin:${path}`),
    apply: async (paths: string[]) => void log.push(`overlay.apply:${paths.join(',')}`),
    release: async () => void log.push('overlay.release'),
    turnStart: async () => void log.push('overlay.turnStart'),
    turnEnd: async () => void log.push('overlay.turnEnd'),
  }),
}))

const handlers = new Map<string, (...args: unknown[]) => unknown>()

const { registerIpc, HEARTH_CHANNELS } = await import('./ipc.js')
type Services = Parameters<typeof registerIpc>[0]

/** A capture-everything stub of MainServices; only what the agentPrompt path
 *  touches is implemented, the rest is reached lazily by other handlers. */
function makeServices(opts?: {
  prompt?: () => Promise<string | null>
  captureResult?: unknown
  meta?: { acpSessionId?: string } | null
}) {
  const noopEvents = {
    onUpdate: () => {},
    onPermission: () => {},
    onAgentExit: () => () => {},
    onModelsChanged: () => {},
    onModeChanged: () => {},
    onConfigChanged: () => {},
    onUsageChanged: () => {},
    onCommandsChanged: () => {},
  }
  const host = {
    ...noopEvents,
    kind: 'claude',
    prompt: async (...args: unknown[]) => {
      log.push('host.prompt')
      const r = opts?.prompt ? await opts.prompt() : 'acp-1'
      void args
      return r
    },
  }
  const selfMod = {
    recoverIfIncomplete: async (key: string) => {
      log.push(`selfMod.recoverIfIncomplete:${key}`)
      // Yield a tick so an out-of-order baseline snapshot would be caught.
      await Promise.resolve()
      log.push('selfMod.recoverIfIncomplete:done')
    },
    dirtyPaths: async () => {
      log.push('selfMod.dirtyPaths')
      return ['pre-existing.ts']
    },
    beginTurn: () => void log.push('selfMod.beginTurn'),
    captureTurn: async (key: string, title: string, before: string[], run?: { runId: string }) => {
      log.push(`selfMod.captureTurn:${key}:before=${before.join(',')}:run=${run ? 'yes' : 'no'}`)
      return opts?.captureResult ?? null
    },
  }
  const sessions = {
    getMeta: async (key: string) => {
      log.push(`sessions.getMeta:${key}`)
      return opts?.meta ?? null
    },
    setAcpSessionId: async (key: string, id: string) => void log.push(`sessions.setAcpSessionId:${key}:${id}`),
  }
  const window = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
        if (channel === HEARTH_CHANNELS.selfModActivity) log.push('send.selfModActivity')
      },
    },
  }
  return {
    repoRoot: '/repo',
    host,
    selfMod,
    sessions,
    window,
    workspaces: {},
    browser: {},
    secrets: {},
    mcp: {},
    capabilities: {},
    broker: {},
    routines: {},
    scheduler: {},
    updater: {},
  } as unknown as Services
}

function promptHandler() {
  const h = handlers.get(HEARTH_CHANNELS.agentPrompt)
  if (!h) throw new Error('agentPrompt handler not registered')
  return h
}

beforeEach(() => {
  log.length = 0
  sent.length = 0
  handlers.clear()
})

describe('agentPrompt turn lifecycle (characterization)', () => {
  test('happy turn fires the full ordered sequence once', async () => {
    registerIpc(makeServices())
    const result = await promptHandler()(null, { sessionId: 's1', text: 'do the thing' })

    expect(log).toEqual([
      'selfMod.recoverIfIncomplete:s1',
      'selfMod.recoverIfIncomplete:done',
      'selfMod.dirtyPaths',
      'selfMod.beginTurn',
      'overlay.turnStart',
      'sessions.getMeta:s1',
      'host.prompt',
      'sessions.setAcpSessionId:s1:acp-1',
      'overlay.apply:',
      'send.selfModActivity',
      'selfMod.captureTurn:s1:before=pre-existing.ts:run=yes',
      'overlay.turnEnd',
    ])
    expect(result).toBeNull()
  })

  test('prompt rejection: endRun effects + captureTurn still fire (finally), partial edit committed', async () => {
    registerIpc(
      makeServices({
        prompt: () => Promise.reject(new Error('adapter died')),
      }),
    )
    await expect(promptHandler()(null, { sessionId: 's1', text: 'boom turn' })).rejects.toThrow('adapter died')

    // The finally block ran: overlay batch applied, lanes cleared, and the
    // partial turn was still captured (with the dirty baseline + run meta).
    const tail = log.slice(log.indexOf('host.prompt') + 1)
    expect(tail).toEqual([
      'overlay.apply:',
      'send.selfModActivity',
      'selfMod.captureTurn:s1:before=pre-existing.ts:run=yes',
      'overlay.turnEnd',
    ])
  })

  test('JSON-RPC error object (not an Error) normalizes to a clean message', async () => {
    registerIpc(
      makeServices({
        prompt: () => Promise.reject({ code: -32603, message: 'Internal error' }),
      }),
    )
    await expect(promptHandler()(null, { sessionId: 's1', text: 'x' })).rejects.toThrow('Internal error')
  })

  test('message-less rejection objects stringify rather than become [object Object]', async () => {
    registerIpc(makeServices({ prompt: () => Promise.reject({ code: 42 }) }))
    await expect(promptHandler()(null, { sessionId: 's1', text: 'x' })).rejects.toThrow('{"code":42}')
  })

  test('recovery of an interrupted prior turn fully completes before the dirty baseline snapshot', async () => {
    registerIpc(makeServices())
    await promptHandler()(null, { sessionId: 's1', text: 'x' })
    expect(log.indexOf('selfMod.recoverIfIncomplete:done')).toBeLessThan(log.indexOf('selfMod.dirtyPaths'))
  })

  test('a resumable session passes its stored ACP id; an unchanged id is not re-persisted', async () => {
    registerIpc(makeServices({ meta: { acpSessionId: 'acp-1' } }))
    await promptHandler()(null, { sessionId: 's1', text: 'x' })
    expect(log).not.toContain('sessions.setAcpSessionId:s1:acp-1')
  })

  test('two prompts on the same cwd serialize: the second turn starts after the first ends', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<string>((r) => (releaseFirst = () => r('acp-1')))
    let call = 0
    registerIpc(makeServices({ prompt: () => (++call === 1 ? firstGate : Promise.resolve('acp-2')) }))

    const first = promptHandler()(null, { sessionId: 's1', text: 'first' })
    const second = promptHandler()(null, { sessionId: 's2', text: 'second' })
    // Give the second turn every chance to (wrongly) start before the first ends.
    await new Promise((r) => setTimeout(r, 10))
    expect(log.filter((l) => l.startsWith('selfMod.recoverIfIncomplete:s2'))).toEqual([])

    releaseFirst()
    await first
    await second
    expect(log.indexOf('selfMod.recoverIfIncomplete:s2')).toBeGreaterThan(log.indexOf('overlay.turnEnd'))
  })
})
