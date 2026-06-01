import { test, expect, describe } from 'bun:test'
import { FakeAgent } from './fake.js'
import type { SessionUpdate } from './agent.js'

async function runTurn(answer?: 'allow' | 'always' | 'reject') {
  const agent = new FakeAgent()
  const updates: SessionUpdate[] = []
  agent.onUpdate((_s, u) => updates.push(u))
  let asked = false
  if (answer) {
    agent.onPermission(async (_s, req) => {
      asked = true
      return req.options.find((o) => o.id === answer)?.id ?? answer
    })
  }
  await agent.connect()
  const session = await agent.newSession()
  await session.prompt('change the sidebar title')
  return { updates, asked }
}

describe('FakeAgent scripted turn', () => {
  test('emits every update variant in order and ends', async () => {
    const { updates } = await runTurn('allow')
    const types = updates.map((u) => u.type)
    expect(types).toEqual(['message', 'plan', 'thought', 'tool-call', 'diff', 'tool-call', 'message', 'end'])
    expect(updates.at(-1)).toEqual({ type: 'end', stopReason: 'end_turn' })
  })

  test('the diff carries a path and both texts', async () => {
    const { updates } = await runTurn('allow')
    const diff = updates.find((u) => u.type === 'diff')
    expect(diff).toMatchObject({ type: 'diff', path: 'src/shell/Sidebar.tsx' })
  })

  test('approving leaves the final tool-call done', async () => {
    const { updates, asked } = await runTurn('allow')
    expect(asked).toBe(true)
    const toolCalls = updates.filter((u) => u.type === 'tool-call')
    expect(toolCalls.at(-1)).toMatchObject({ status: 'done' })
  })

  test('rejecting flips the final tool-call to error and changes the closing message', async () => {
    const { updates } = await runTurn('reject')
    const toolCalls = updates.filter((u) => u.type === 'tool-call')
    expect(toolCalls.at(-1)).toMatchObject({ status: 'error' })
    const lastMessage = [...updates].reverse().find((u) => u.type === 'message')
    expect(lastMessage).toMatchObject({ type: 'message' })
    expect((lastMessage as { text: string }).text).toContain('unchanged')
  })

  test('with no permission handler the turn still completes (defaults to approved)', async () => {
    const { updates, asked } = await runTurn(undefined)
    expect(asked).toBe(false)
    expect(updates.at(-1)?.type).toBe('end')
    const toolCalls = updates.filter((u) => u.type === 'tool-call')
    expect(toolCalls.at(-1)).toMatchObject({ status: 'done' })
  })
})
