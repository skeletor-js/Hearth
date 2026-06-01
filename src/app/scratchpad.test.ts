import { test, expect, describe } from 'bun:test'
import { clampScratchpad, wrapForPrompt, SCRATCHPAD_MAX } from './scratchpad'

describe('clampScratchpad', () => {
  test('passes short text through', () => {
    expect(clampScratchpad('hi')).toBe('hi')
  })
  test('truncates past the cap', () => {
    const long = 'x'.repeat(SCRATCHPAD_MAX + 50)
    expect(clampScratchpad(long).length).toBe(SCRATCHPAD_MAX)
  })
})

describe('wrapForPrompt', () => {
  test('blank pad → typed unchanged', () => {
    expect(wrapForPrompt('do the thing', '')).toBe('do the thing')
    expect(wrapForPrompt('do the thing', '   \n ')).toBe('do the thing')
  })

  test('non-blank pad is fenced before the typed text', () => {
    const out = wrapForPrompt('go', 'note one')
    expect(out).toBe('```scratchpad\nnote one\n```\n\ngo')
  })

  test('pad containing a fence cannot break out (longer outer fence)', () => {
    const pad = 'before\n```\nrm -rf\n```\nafter'
    const out = wrapForPrompt('go', pad)
    // Outer fence must be longer than the 3-backtick run inside.
    expect(out.startsWith('````scratchpad\n')).toBe(true)
    expect(out.endsWith('\n````\n\ngo')).toBe(true)
    // The typed text stays outside the fenced block.
    expect(out.includes(pad)).toBe(true)
  })
})
