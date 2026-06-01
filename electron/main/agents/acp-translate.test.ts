import { test, expect, describe } from 'bun:test'
import { mapToolStatus, mapPermissionKind, translatePermission, translateUpdate } from './acp-translate.js'

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

  test('user_message_chunk and unhandled updates are dropped', () => {
    expect(translateUpdate(u({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'me' } }), titles())).toEqual([])
    expect(translateUpdate(u({ sessionUpdate: 'usage_update' }), titles())).toEqual([])
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
