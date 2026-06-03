import { expect, test } from 'bun:test'
import { toToolSlug } from './SaveAsTool'

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

test('slugifies a display name into a valid micro-app id', () => {
  expect(toToolSlug('Launch Tracker')).toBe('launch-tracker')
  expect(toToolSlug('Q3 Content Calendar!')).toBe('q3-content-calendar')
  expect(toToolSlug('  My Tool  ')).toBe('my-tool')
})

test('strips a leading non-alphanumeric so the first char is valid', () => {
  expect(toToolSlug('-weird')).toBe('weird')
  expect(toToolSlug('_under')).toBe('under')
  expect(toToolSlug('123 go')).toBe('123-go')
})

test('every non-empty slug satisfies NAME_RE', () => {
  for (const s of ['Launch Tracker', 'a', 'Q3!!!Calendar', 'CRM lite', 'plan_2026']) {
    const slug = toToolSlug(s)
    expect(slug).not.toBe('')
    expect(NAME_RE.test(slug)).toBe(true)
  }
})

test('returns empty when nothing valid remains', () => {
  expect(toToolSlug('')).toBe('')
  expect(toToolSlug('!!!')).toBe('')
  expect(toToolSlug('   ')).toBe('')
})
