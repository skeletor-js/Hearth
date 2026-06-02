import { test, expect, describe } from 'bun:test'
import { mapToolStatus, mapPermissionKind, translatePermission, translateUpdate, normalizeModels, normalizeModes, normalizeConfigOptions } from './acp-translate.js'

describe('normalizeModels', () => {
  test('absent/null → empty', () => {
    expect(normalizeModels(null)).toEqual({ available: [], current: null })
    expect(normalizeModels(undefined)).toEqual({ available: [], current: null })
  })
  test('maps available models + current id, dropping null descriptions', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state: any = {
      availableModels: [
        { modelId: 'sonnet', name: 'Sonnet', description: null },
        { modelId: 'opus', name: 'Opus', description: 'most capable' },
      ],
      currentModelId: 'sonnet',
    }
    expect(normalizeModels(state)).toEqual({
      available: [
        { id: 'sonnet', name: 'Sonnet', description: undefined },
        { id: 'opus', name: 'Opus', description: 'most capable' },
      ],
      current: 'sonnet',
    })
  })
})

describe('normalizeModes', () => {
  test('absent/null → empty', () => {
    expect(normalizeModes(null)).toEqual({ available: [], current: null })
    expect(normalizeModes(undefined)).toEqual({ available: [], current: null })
  })
  test('maps available modes + current id, dropping null descriptions', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state: any = {
      availableModes: [
        { id: 'default', name: 'Default', description: 'prompts for dangerous ops' },
        { id: 'plan', name: 'Plan Mode', description: null },
      ],
      currentModeId: 'default',
    }
    expect(normalizeModes(state)).toEqual({
      available: [
        { id: 'default', name: 'Default', description: 'prompts for dangerous ops' },
        { id: 'plan', name: 'Plan Mode', description: undefined },
      ],
      current: 'default',
    })
  })
})

describe('normalizeConfigOptions', () => {
  test('absent → empty', () => {
    expect(normalizeConfigOptions(null)).toEqual([])
    expect(normalizeConfigOptions(undefined)).toEqual([])
  })
  test('maps a select option (flat) and a boolean option', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'opus',
        options: [
          { value: 'opus', name: 'Opus', description: null },
          { value: 'sonnet', name: 'Sonnet', description: 'fast' },
        ],
      },
      { id: 'verbose', name: 'Verbose', category: '_custom', type: 'boolean', currentValue: true },
    ]
    expect(normalizeConfigOptions(opts)).toEqual([
      {
        id: 'model',
        name: 'Model',
        description: undefined,
        category: 'model',
        type: 'select',
        current: 'opus',
        options: [
          { value: 'opus', name: 'Opus', description: undefined },
          { value: 'sonnet', name: 'Sonnet', description: 'fast' },
        ],
      },
      { id: 'verbose', name: 'Verbose', description: undefined, category: '_custom', type: 'boolean', current: true },
    ])
  })
  test('flattens grouped select options', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = [
      {
        id: 'thought_level',
        name: 'Reasoning',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { group: 'g1', name: 'Group 1', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
        ],
      },
    ]
    expect(normalizeConfigOptions(opts)).toEqual([
      {
        id: 'thought_level',
        name: 'Reasoning',
        description: undefined,
        category: 'thought_level',
        type: 'select',
        current: 'high',
        options: [
          { value: 'low', name: 'Low', description: undefined },
          { value: 'high', name: 'High', description: undefined },
        ],
      },
    ])
  })
})

describe('mapToolStatus', () => {
  test('maps known ACP statuses', () => {
    expect(mapToolStatus('pending', false)).toBe('pending')
    expect(mapToolStatus('in_progress', false)).toBe('running')
    expect(mapToolStatus('completed', false)).toBe('done')
    expect(mapToolStatus('failed', false)).toBe('error')
  })

  test('defaults: a new tool_call with no status is pending, an update is running', () => {
    expect(mapToolStatus(undefined, false)).toBe('pending')
    expect(mapToolStatus(null, false)).toBe('pending')
    expect(mapToolStatus(undefined, true)).toBe('running')
  })
})

describe('mapPermissionKind', () => {
  test('collapses the four ACP kinds into three', () => {
    expect(mapPermissionKind('allow_once')).toBe('allow')
    expect(mapPermissionKind('allow_always')).toBe('allow-always')
    expect(mapPermissionKind('reject_once')).toBe('reject')
    expect(mapPermissionKind('reject_always')).toBe('reject')
  })
})

describe('translatePermission', () => {
  test('uses the tool call id as the permission id and maps options', () => {
    const req = {
      sessionId: 's1',
      toolCall: { toolCallId: 'tc-7', title: 'Write file foo.ts' },
      options: [
        { optionId: 'o1', name: 'Allow', kind: 'allow_once' as const },
        { optionId: 'o2', name: 'Always allow', kind: 'allow_always' as const },
        { optionId: 'o3', name: 'Reject', kind: 'reject_once' as const },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    expect(translatePermission(req)).toEqual({
      id: 'tc-7',
      title: 'Write file foo.ts',
      options: [
        { id: 'o1', label: 'Allow', kind: 'allow' },
        { id: 'o2', label: 'Always allow', kind: 'allow-always' },
        { id: 'o3', label: 'Reject', kind: 'reject' },
      ],
    })
  })

  test('falls back to a generic title when the tool call has none', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { sessionId: 's', toolCall: { toolCallId: 'tc' }, options: [] } as any
    expect(translatePermission(req).title).toBe('Permission requested')
  })
})

describe('translateUpdate', () => {
  const titles = () => new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = (x: any) => x // shape helper; ACP types are wide unions

  test('agent_message_chunk (text) -> message', () => {
    expect(
      translateUpdate(u({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }), titles()),
    ).toEqual([{ type: 'message', role: 'assistant', text: 'hi' }])
  })

  test('non-text message content is dropped', () => {
    expect(
      translateUpdate(
        u({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: '...', mimeType: 'image/png' } }),
        titles(),
      ),
    ).toEqual([])
  })

  test('agent_thought_chunk (text) -> thought', () => {
    expect(
      translateUpdate(u({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }), titles()),
    ).toEqual([{ type: 'thought', text: 'hmm' }])
  })

  test('tool_call -> tool-call and caches its title', () => {
    const cache = titles()
    const out = translateUpdate(u({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit', status: 'pending' }), cache)
    expect(out).toEqual([{ type: 'tool-call', id: 't1', title: 'Edit', status: 'pending' }])
    expect(cache.get('t1')).toBe('Edit')
  })

  test('tool_call_update backfills the title from the cache', () => {
    const cache = new Map([['t1', 'Edit foo.ts']])
    const out = translateUpdate(u({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' }), cache)
    expect(out).toEqual([{ type: 'tool-call', id: 't1', title: 'Edit foo.ts', status: 'done' }])
  })

  test('tool_call_update with no cached title uses a placeholder', () => {
    const out = translateUpdate(u({ sessionUpdate: 'tool_call_update', toolCallId: 'tx', status: 'in_progress' }), titles())
    expect(out).toEqual([{ type: 'tool-call', id: 'tx', title: 'Tool call', status: 'running' }])
  })

  test('a tool call carrying a diff emits both the status and a diff update', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'tool_call',
        toolCallId: 't2',
        title: 'Write',
        status: 'completed',
        content: [{ type: 'diff', path: 'src/x.ts', oldText: 'a', newText: 'b' }],
      }),
      titles(),
    )
    expect(out).toEqual([
      { type: 'tool-call', id: 't2', title: 'Write', status: 'done' },
      { type: 'diff', path: 'src/x.ts', oldText: 'a', newText: 'b' },
    ])
  })

  test('subagent attribution: _meta.claudeCode.parentToolUseId threads onto tool-call + diff', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'tool_call',
        toolCallId: 'edit1',
        title: 'Edit',
        status: 'completed',
        content: [{ type: 'diff', path: 'src/x.ts', oldText: 'a', newText: 'b' }],
        _meta: { claudeCode: { parentToolUseId: 'taskA' } },
      }),
      titles(),
    )
    expect(out).toEqual([
      { type: 'tool-call', id: 'edit1', title: 'Edit', status: 'done', parentToolCallId: 'taskA' },
      { type: 'diff', path: 'src/x.ts', oldText: 'a', newText: 'b', parentToolCallId: 'taskA' },
    ])
  })

  test('no _meta (main thread / Codex) → no parentToolCallId key', () => {
    const out = translateUpdate(
      u({ sessionUpdate: 'tool_call', toolCallId: 't9', title: 'Edit', status: 'pending' }),
      titles(),
    )
    expect(out).toEqual([{ type: 'tool-call', id: 't9', title: 'Edit', status: 'pending' }])
    expect('parentToolCallId' in out[0]).toBe(false)
  })

  test('a diff for a new file (no oldText) maps oldText to null', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't3',
        content: [{ type: 'diff', path: 'src/new.ts', newText: 'hello' }],
      }),
      new Map([['t3', 'Create']]),
    )
    expect(out).toContainEqual({ type: 'diff', path: 'src/new.ts', oldText: null, newText: 'hello' })
  })

  test('non-diff tool content (plain content blocks) produces no diff updates', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'tool_call',
        toolCallId: 't4',
        title: 'Run',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: 'output' } }],
      }),
      titles(),
    )
    expect(out).toEqual([{ type: 'tool-call', id: 't4', title: 'Run', status: 'running' }])
  })

  test('user_message_chunk and title-less session_info_update are dropped', () => {
    expect(translateUpdate(u({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'me' } }), titles())).toEqual([])
    expect(translateUpdate(u({ sessionUpdate: 'session_info_update' }), titles())).toEqual([])
  })

  test('session_info_update with a title -> info update (W9)', () => {
    expect(translateUpdate(u({ sessionUpdate: 'session_info_update', title: 'Refactor auth' }), titles())).toEqual([
      { type: 'info', title: 'Refactor auth' },
    ])
  })

  test('current_mode_update -> mode update', () => {
    expect(translateUpdate(u({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }), titles())).toEqual([
      { type: 'mode', current: 'plan' },
    ])
  })

  test('config_option_update -> config update (normalized)', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'mode',
            name: 'Mode',
            category: 'mode',
            type: 'select',
            currentValue: 'default',
            options: [{ value: 'default', name: 'Default', description: null }],
          },
        ],
      }),
      titles(),
    )
    expect(out).toEqual([
      {
        type: 'config',
        options: [
          {
            id: 'mode',
            name: 'Mode',
            description: undefined,
            category: 'mode',
            type: 'select',
            current: 'default',
            options: [{ value: 'default', name: 'Default', description: undefined }],
          },
        ],
      },
    ])
  })

  test('usage_update -> usage update with context + cost', () => {
    expect(
      translateUpdate(u({ sessionUpdate: 'usage_update', used: 1200, size: 200000, cost: { amount: 0.04, currency: 'USD' } }), titles()),
    ).toEqual([{ type: 'usage', usage: { used: 1200, size: 200000, cost: { amount: 0.04, currency: 'USD' } } }])
  })

  test('usage_update without cost omits the cost key', () => {
    expect(translateUpdate(u({ sessionUpdate: 'usage_update', used: 10, size: 100 }), titles())).toEqual([
      { type: 'usage', usage: { used: 10, size: 100 } },
    ])
  })

  test('available_commands_update -> commands update (name + description)', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'deep-research', description: 'Run a research harness' },
          { name: 'verify', description: null },
        ],
      }),
      titles(),
    )
    expect(out).toEqual([
      {
        type: 'commands',
        commands: [
          { name: 'deep-research', description: 'Run a research harness' },
          { name: 'verify', description: undefined },
        ],
      },
    ])
  })

  test('plan -> plan update carrying entries (content/status/priority)', () => {
    const out = translateUpdate(
      u({
        sessionUpdate: 'plan',
        entries: [
          { content: 'Read the file', status: 'completed', priority: 'high' },
          { content: 'Make the edit', status: 'in_progress', priority: 'medium' },
        ],
      }),
      titles(),
    )
    expect(out).toEqual([
      {
        type: 'plan',
        entries: [
          { content: 'Read the file', status: 'completed', priority: 'high' },
          { content: 'Make the edit', status: 'in_progress', priority: 'medium' },
        ],
      },
    ])
  })
})
