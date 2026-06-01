import { expect, test } from 'bun:test'
import { readBlock, upsertBlock } from './managed-block.js'
import { compileSoul } from './soul.js'

test('inserts a managed block, preserving existing content', () => {
  const out = upsertBlock('# My notes\n\nHello.\n', 'managed', 'generated body')
  expect(out).toContain('# My notes')
  expect(out).toContain('Hello.')
  expect(out).toContain('<!-- HEARTH:managed')
  expect(out).toContain('generated body')
  expect(out.trim().endsWith('<!-- /HEARTH:managed -->')).toBe(true)
})

test('replaces an existing block in place without duplicating', () => {
  const once = upsertBlock('user content\n', 'managed', 'v1')
  const twice = upsertBlock(once, 'managed', 'v2')
  expect(twice.match(/<!-- HEARTH:managed/g)?.length).toBe(1) // single open marker
  expect(twice).toContain('v2')
  expect(twice).not.toContain('v1')
  expect(twice).toContain('user content')
})

test('two distinct blocks coexist', () => {
  let c = upsertBlock('top\n', 'managed', 'soul stuff')
  c = upsertBlock(c, 'memory', 'memory stuff')
  expect(readBlock(c, 'managed')).toBe('soul stuff')
  expect(readBlock(c, 'memory')).toBe('memory stuff')
  expect(c).toContain('top')
})

test('empty body removes the block and restores user content', () => {
  const withBlock = upsertBlock('keep me\n', 'managed', 'temp')
  const removed = upsertBlock(withBlock, 'managed', '   ')
  expect(removed).not.toContain('HEARTH:managed')
  expect(removed).toContain('keep me')
})

test('readBlock returns null when absent', () => {
  expect(readBlock('nothing here', 'managed')).toBeNull()
})

test('compileSoul reflects the chosen personality', () => {
  const s = compileSoul({ length: 'short', directness: 'direct', density: 'compact' })
  expect(s).toContain('## Soul')
  expect(s).toContain('short')
  expect(s.toLowerCase()).toContain('direct')
})
