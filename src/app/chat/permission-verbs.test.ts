import { expect, test } from 'bun:test'
import { humanizePermission } from './permission-verbs'
import type { PermissionRequest } from '../../../electron/shared/protocol'

const base = (over: Partial<PermissionRequest>): PermissionRequest => ({
  id: 'p1',
  title: 'raw title',
  options: [],
  ...over,
})

test('execute asks lead with plain language and surface the command', () => {
  const h = humanizePermission(base({ category: 'execute', command: 'rm -rf build' }))
  expect(h.lead).toBe('Hearth wants to run a command in the terminal.')
  expect(h.detail).toBe('rm -rf build')
})

test('edit asks keep the concrete agent title', () => {
  const h = humanizePermission(base({ category: 'edit', title: 'Edit src/app.tsx' }))
  expect(h.lead).toBe('Edit src/app.tsx')
  expect(h.detail).toBeUndefined()
})

test('other/unknown asks fall back to the agent title, never hidden', () => {
  expect(humanizePermission(base({ category: 'other', title: 'Send a message to #general' })).lead).toBe(
    'Send a message to #general',
  )
  expect(humanizePermission(base({ title: 'mystery tool' })).lead).toBe('mystery tool')
})

test('a titleless ask still yields a usable sentence', () => {
  expect(humanizePermission(base({ category: 'other', title: '' })).lead).toBe(
    'Hearth wants your permission to continue.',
  )
})
