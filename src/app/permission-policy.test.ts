import { test, expect, describe } from 'bun:test'
import { decidePermission, type PermissionContext } from './permission-policy'
import type { PermissionRequest } from '../../electron/shared/protocol'

const req = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: 'perm-1',
  title: 'Run bun test',
  category: 'command',
  options: [
    { id: 'allow-1', label: 'Allow', kind: 'allow' },
    { id: 'reject-1', label: 'Reject', kind: 'reject' },
  ],
  ...over,
})

const ctx = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  mode: 'commands',
  isActiveSession: false,
  isBackgroundRun: false,
  ...over,
})

describe('decidePermission (U7)', () => {
  test('a background (headless) ask that needs a human fails closed via the reject option', () => {
    const d = decidePermission(req(), ctx({ isBackgroundRun: true }))
    expect(d).toEqual({ action: 'respond', optionId: 'reject-1', reason: 'fail-closed' })
  })

  test('the same ask on the foreground session still prompts normally', () => {
    const d = decidePermission(req(), ctx({ isBackgroundRun: true, isActiveSession: true }))
    expect(d).toEqual({ action: 'surface' })
  })

  test('an interactive (non-routine) background session still prompts normally', () => {
    // A user-started turn the user has merely tabbed away from is NOT headless.
    const d = decidePermission(req(), ctx({ isBackgroundRun: false }))
    expect(d).toEqual({ action: 'surface' })
  })

  test("the user's auto tier still auto-approves background asks (fail-closed only replaces hangs)", () => {
    const d = decidePermission(req(), ctx({ mode: 'auto', isBackgroundRun: true }))
    expect(d).toEqual({ action: 'respond', optionId: 'allow-1', reason: 'auto-approve' })
  })

  test("'commands' tier auto-approves a read/MCP ask even on a background run", () => {
    const d = decidePermission(req({ category: 'other' }), ctx({ isBackgroundRun: true }))
    expect(d).toEqual({ action: 'respond', optionId: 'allow-1', reason: 'auto-approve' })
  })

  test('a background ask with no reject option surfaces rather than guessing', () => {
    const r = req({ options: [{ id: 'allow-1', label: 'Allow', kind: 'allow' }] })
    const d = decidePermission(r, ctx({ mode: 'always', isBackgroundRun: true }))
    expect(d).toEqual({ action: 'surface' })
  })

  test("foreground 'always' tier prompts for everything (unchanged)", () => {
    const d = decidePermission(req({ category: 'other' }), ctx({ mode: 'always', isActiveSession: true }))
    expect(d).toEqual({ action: 'surface' })
  })
})

describe('presence attention flag (U7)', () => {
  test('a fail-closed denial marks the run attention-needed and it survives the turn ending', async () => {
    const { usePresence } = await import('./presence-store')
    const s = usePresence.getState()
    s.markSending('routine-run')
    s.markBackgroundRun('routine-run')
    s.flagAttention('routine-run', 'Declined unattended: Run bun test')
    s.applyUpdate('routine-run', { type: 'end', stopReason: 'end_turn' }, false)

    const p = usePresence.getState().byId['routine-run']
    expect(p.needsAttention).toBe('Declined unattended: Run bun test')
    expect(p.unread).toBe(true)
    expect(p.status).toBe('done') // attention rides alongside, not instead of, the result
  })
})
