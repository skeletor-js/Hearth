import { test, expect, describe } from 'bun:test'
import {
  assertCreateRoutineInput,
  assertMcpServerInput,
  assertMcpServerPatch,
  assertRoutinePatch,
  assertSoulConfig,
  InvalidInputError,
} from './ipc-validate.js'

const goodRoutine = {
  title: 'Morning digest',
  prompt: 'Summarize overnight activity.',
  schedule: { type: 'daily', time: '08:30' },
  workspaceId: 'hearth',
  cwd: '/repo',
}

const goodServer = {
  name: 'docs',
  enabled: true,
  transport: { type: 'stdio', command: 'docs-mcp', args: ['--quiet'] },
  env: [{ name: 'TOKEN', secretKey: 'mcp.docs.token' }],
}

describe('U22 disk-bound IPC input validation', () => {
  test('well-formed inputs pass unchanged', () => {
    expect(() => assertCreateRoutineInput(goodRoutine)).not.toThrow()
    expect(() => assertCreateRoutineInput({ ...goodRoutine, schedule: { type: 'interval', everyMinutes: 30 } })).not.toThrow()
    expect(() => assertMcpServerInput(goodServer)).not.toThrow()
    expect(() => assertMcpServerInput({ ...goodServer, transport: { type: 'http', url: 'https://x' } })).not.toThrow()
    expect(() => assertSoulConfig({ length: 'short', directness: 'direct', density: 'roomy' })).not.toThrow()
  })

  test('malformed CreateRoutineInput rejects with a typed error, nothing written', () => {
    expect(() => assertCreateRoutineInput(null)).toThrow(InvalidInputError)
    expect(() => assertCreateRoutineInput({ ...goodRoutine, title: '' })).toThrow('non-empty string title')
    expect(() => assertCreateRoutineInput({ ...goodRoutine, prompt: 42 })).toThrow('prompt')
    expect(() => assertCreateRoutineInput({ ...goodRoutine, schedule: { type: 'daily', time: 'soonish' } })).toThrow('HH:MM')
    expect(() => assertCreateRoutineInput({ ...goodRoutine, schedule: { type: 'interval', everyMinutes: -5 } })).toThrow('positive')
    expect(() => assertCreateRoutineInput({ ...goodRoutine, schedule: { type: 'cron', expr: '* * *' } })).toThrow('daily | interval')
    const missingCwd = { ...goodRoutine } as Record<string, unknown>
    delete missingCwd.cwd
    expect(() => assertCreateRoutineInput(missingCwd)).toThrow('cwd')
  })

  test('malformed McpServerInput rejects', () => {
    expect(() => assertMcpServerInput(undefined)).toThrow(InvalidInputError)
    expect(() => assertMcpServerInput({ ...goodServer, name: '  ' })).toThrow('name')
    expect(() => assertMcpServerInput({ ...goodServer, enabled: 'yes' })).toThrow('boolean')
    expect(() => assertMcpServerInput({ ...goodServer, transport: { type: 'stdio', command: 'x', args: 'not-array' } })).toThrow('string[] args')
    expect(() => assertMcpServerInput({ ...goodServer, transport: { type: 'websocket', url: 'ws://x' } })).toThrow('stdio | http | sse')
    expect(() => assertMcpServerInput({ ...goodServer, env: [{ name: 7 }] })).toThrow('string name')
  })

  test('malformed SoulConfig rejects', () => {
    expect(() => assertSoulConfig(null)).toThrow(InvalidInputError)
    expect(() => assertSoulConfig({ length: 'epic', directness: 'direct', density: 'compact' })).toThrow('length must be one of')
    expect(() => assertSoulConfig({ length: 'short', directness: 'direct' })).toThrow('density')
  })

  test('patches validate exactly the fields present', () => {
    expect(() => assertRoutinePatch({})).not.toThrow()
    expect(() => assertRoutinePatch({ title: 'renamed' })).not.toThrow()
    expect(() => assertRoutinePatch({ title: '' })).toThrow('title')
    expect(() => assertRoutinePatch({ schedule: { type: 'interval', everyMinutes: 0 } })).toThrow('positive')
    expect(() => assertMcpServerPatch({ enabled: false })).not.toThrow()
    expect(() => assertMcpServerPatch({ env: [{ value: 'x' }] })).toThrow('string name')
  })

  test('the rejection is typed (code: invalid-input)', () => {
    try {
      assertSoulConfig({})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidInputError)
      expect((e as InvalidInputError).code).toBe('invalid-input')
    }
  })
})
