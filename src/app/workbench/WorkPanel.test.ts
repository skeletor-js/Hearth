import { expect, test } from 'bun:test'
import { selectWorkbenchTabs } from './WorkPanel'

const allNeeded = () => true

test('code workspace shows the full developer workbench', () => {
  const ids = selectWorkbenchTabs('code', { offSession: false, needed: allNeeded }).map((t) => t.id)
  expect(ids).toContain('terminal')
  expect(ids).toContain('review')
  expect(ids).toContain('self')
  expect(ids).toContain('agents')
  expect(ids).not.toContain('sources') // Sources is a knowledge-only surface
})

test('knowledge workspace hides the dev seams', () => {
  const ids = selectWorkbenchTabs('knowledge', { offSession: false, needed: allNeeded }).map((t) => t.id)
  expect(ids).not.toContain('terminal')
  expect(ids).not.toContain('review')
  expect(ids).not.toContain('self')
  expect(ids).not.toContain('agents')
  // but keeps the shared tools + plan, and adds Sources
  expect(ids).toContain('sources')
  expect(ids).toContain('files')
  expect(ids).toContain('scratchpad')
  expect(ids).toContain('browser')
  expect(ids).toContain('plan')
})

test('contextual tabs stay hidden until needed', () => {
  const none = (id: string) => id !== 'review' && id !== 'plan' && id !== 'self' && id !== 'agents'
  const ids = selectWorkbenchTabs('code', { offSession: false, needed: none }).map((t) => t.id)
  expect(ids).not.toContain('review')
  expect(ids).not.toContain('plan')
})

test('off-session shows only the always-tools', () => {
  const ids = selectWorkbenchTabs('code', { offSession: true, needed: allNeeded }).map((t) => t.id)
  expect(ids).toEqual(['files', 'scratchpad', 'terminal', 'browser'])
})
