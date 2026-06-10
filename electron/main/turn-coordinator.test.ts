// U13: the U3 characterization scenarios, migrated to run against the
// extracted TurnCoordinator directly — no Electron, no module mocks, pure
// injected dependencies. ipc.turn-lifecycle.test.ts keeps pinning the same
// invariants end-to-end through the registered IPC handler.
import { test, expect, describe, beforeEach } from 'bun:test'
import { TurnCoordinator, type TurnCoordinatorDeps } from './turn-coordinator.js'
import { RunTracker } from './self-mod/run-tracker.js'
import { HEARTH_CHANNELS } from '../shared/channels.js'

const log: string[] = []
const sent: Array<{ channel: string; payload: unknown }> = []

function makeDeps(opts?: {
  prompt?: () => Promise<string | null>
  captureResult?: unknown
  meta?: { acpSessionId?: string } | null
  typecheck?: () => Promise<{ ok: boolean; output: string }>
}): TurnCoordinatorDeps {
  return {
    repoRoot: '/repo',
    host: {
      prompt: async () => {
        log.push('host.prompt')
        return opts?.prompt ? await opts.prompt() : 'acp-1'
      },
    } as TurnCoordinatorDeps['host'],
    selfMod: {
      recoverIfIncomplete: async (key: string) => {
        log.push(`recoverIfIncomplete:${key}`)
        await Promise.resolve() // yield so an out-of-order baseline would show
        log.push('recoverIfIncomplete:done')
      },
      dirtyPaths: async () => {
        log.push('dirtyPaths')
        return ['pre-existing.ts']
      },
      beginTurn: () => void log.push('beginTurn'),
      captureTurn: async (key: string, _title: string, before: string[], run?: { runId: string }) => {
        log.push(`captureTurn:${key}:before=${before.join(',')}:run=${run ? 'yes' : 'no'}`)
        return (opts?.captureResult ?? null) as never
      },
    } as TurnCoordinatorDeps['selfMod'],
    sessions: {
      getMeta: async (key: string) => {
        log.push(`getMeta:${key}`)
        return (opts?.meta ?? null) as never
      },
      setAcpSessionId: async (key: string, id: string) => void log.push(`setAcpSessionId:${key}:${id}`),
    } as TurnCoordinatorDeps['sessions'],
    runTracker: new RunTracker(),
    overlay: {
      pin: async () => {},
      apply: async (paths: string[]) => void log.push(`overlay.apply:${paths.join(',')}`),
      release: async () => {},
      turnStart: async () => void log.push('overlay.turnStart'),
      turnEnd: async () => void log.push('overlay.turnEnd'),
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
      if (channel === HEARTH_CHANNELS.selfModActivity) log.push('send.selfModActivity')
    },
    typecheck: opts?.typecheck ?? (async () => ({ ok: true, output: '' })),
  }
}

beforeEach(() => {
  log.length = 0
  sent.length = 0
})

describe('TurnCoordinator (migrated U3 scenarios)', () => {
  test('happy turn fires the full ordered sequence once', async () => {
    const turns = new TurnCoordinator(makeDeps())
    const result = await turns.runTurn({ sessionId: 's1', text: 'do the thing' })

    expect(log).toEqual([
      'recoverIfIncomplete:s1',
      'recoverIfIncomplete:done',
      'dirtyPaths',
      'beginTurn',
      'overlay.turnStart',
      'getMeta:s1',
      'host.prompt',
      'setAcpSessionId:s1:acp-1',
      'overlay.apply:',
      'send.selfModActivity',
      'captureTurn:s1:before=pre-existing.ts:run=yes',
      'overlay.turnEnd',
    ])
    expect(result).toBeNull()
  })

  test('prompt rejection: endRun effects + captureTurn still fire (finally)', async () => {
    const turns = new TurnCoordinator(makeDeps({ prompt: () => Promise.reject(new Error('adapter died')) }))
    await expect(turns.runTurn({ sessionId: 's1', text: 'boom' })).rejects.toThrow('adapter died')
    const tail = log.slice(log.indexOf('host.prompt') + 1)
    expect(tail).toEqual(['overlay.apply:', 'send.selfModActivity', 'captureTurn:s1:before=pre-existing.ts:run=yes', 'overlay.turnEnd'])
  })

  test('JSON-RPC error object normalizes to a clean message', async () => {
    const turns = new TurnCoordinator(makeDeps({ prompt: () => Promise.reject({ code: -32603, message: 'Internal error' }) }))
    await expect(turns.runTurn({ sessionId: 's1', text: 'x' })).rejects.toThrow('Internal error')
  })

  test('message-less rejection objects stringify rather than become [object Object]', async () => {
    const turns = new TurnCoordinator(makeDeps({ prompt: () => Promise.reject({ code: 42 }) }))
    await expect(turns.runTurn({ sessionId: 's1', text: 'x' })).rejects.toThrow('{"code":42}')
  })

  test('recovery fully completes before the dirty baseline snapshot', async () => {
    const turns = new TurnCoordinator(makeDeps())
    await turns.runTurn({ sessionId: 's1', text: 'x' })
    expect(log.indexOf('recoverIfIncomplete:done')).toBeLessThan(log.indexOf('dirtyPaths'))
  })

  test('an unchanged ACP id is not re-persisted', async () => {
    const turns = new TurnCoordinator(makeDeps({ meta: { acpSessionId: 'acp-1' } }))
    await turns.runTurn({ sessionId: 's1', text: 'x' })
    expect(log).not.toContain('setAcpSessionId:s1:acp-1')
  })

  test('two turns on the same cwd serialize; different cwds run concurrently', async () => {
    let release!: () => void
    const gate = new Promise<string>((r) => (release = () => r('acp-1')))
    let call = 0
    const turns = new TurnCoordinator(makeDeps({ prompt: () => (++call === 1 ? gate : Promise.resolve('acp-2')) }))

    const first = turns.runTurn({ sessionId: 's1', text: 'first' })
    const second = turns.runTurn({ sessionId: 's2', text: 'second' }) // same default cwd
    const elsewhere = turns.runTurn({ sessionId: 's3', cwd: '/other', text: 'third' })
    await new Promise((r) => setTimeout(r, 10))
    expect(log.filter((l) => l === 'recoverIfIncomplete:s2')).toEqual([]) // blocked behind s1
    expect(log).toContain('recoverIfIncomplete:s3') // different cwd — not blocked

    release()
    await Promise.all([first, second, elsewhere])
    expect(log.indexOf('recoverIfIncomplete:s2')).toBeGreaterThan(log.indexOf('overlay.turnEnd'))
  })

  test('scope-guard-rejected paths are surfaced to the renderer', async () => {
    const turns = new TurnCoordinator(
      makeDeps({ captureResult: { changedPaths: [], rejectedPaths: ['electron/main/self-mod/boot-watchdog.ts'] } }),
    )
    await turns.runTurn({ sessionId: 's1', text: 'x' })
    const v = sent.filter((s) => s.channel === HEARTH_CHANNELS.selfModValidation)
    expect(v).toHaveLength(1)
    expect((v[0].payload as { output: string }).output).toContain('boot-watchdog.ts')
  })

  test('a blocked restart surfaces its typecheck output instead of the async gate', async () => {
    const turns = new TurnCoordinator(
      makeDeps({ captureResult: { changedPaths: ['electron/main/index.ts'], blockedRestart: { output: 'TS2304: boom' } } }),
    )
    await turns.runTurn({ sessionId: 's1', text: 'x' })
    const v = sent.filter((s) => s.channel === HEARTH_CHANNELS.selfModValidation)
    expect(v).toHaveLength(1)
    expect((v[0].payload as { output: string }).output).toBe('TS2304: boom')
  })

  test('renderer edits trigger the async validation gate; a failure is surfaced', async () => {
    const turns = new TurnCoordinator(
      makeDeps({
        captureResult: { changedPaths: ['src/app/chat/ChatView.tsx'] },
        typecheck: async () => ({ ok: false, output: 'TS1005: jank' }),
      }),
    )
    await turns.runTurn({ sessionId: 's1', text: 'x' })
    await new Promise((r) => setTimeout(r, 5)) // the gate is fire-and-forget
    const v = sent.filter((s) => s.channel === HEARTH_CHANNELS.selfModValidation)
    expect(v).toHaveLength(1)
    expect((v[0].payload as { output: string }).output).toBe('TS1005: jank')
  })
})
