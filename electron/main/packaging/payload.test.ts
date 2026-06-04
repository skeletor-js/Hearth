import { test, expect, describe } from 'bun:test'
import { versionLt } from './payload.js'

describe('versionLt', () => {
  test('older < newer across each component', () => {
    expect(versionLt('0.1.0', '0.1.1')).toBe(true)
    expect(versionLt('0.1.0', '0.2.0')).toBe(true)
    expect(versionLt('0.9.9', '1.0.0')).toBe(true)
  })
  test('equal is not less-than', () => {
    expect(versionLt('1.2.3', '1.2.3')).toBe(false)
  })
  test('newer is not less-than older', () => {
    expect(versionLt('1.2.3', '1.2.0')).toBe(false)
    expect(versionLt('2.0.0', '1.9.9')).toBe(false)
  })
  test('uneven lengths compare by component', () => {
    expect(versionLt('1.0', '1.0.1')).toBe(true)
    expect(versionLt('1.0.0', '1.0')).toBe(false)
  })
})
