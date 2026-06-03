import { test, expect, describe } from 'bun:test'
import { normalizeUrl } from './url'

describe('normalizeUrl scheme allowlist', () => {
  test('passes through http and https', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeUrl('https://example.com/x')).toBe('https://example.com/x')
  })

  test('allows about:', () => {
    expect(normalizeUrl('about:blank')).toBe('about:blank')
    expect(normalizeUrl('')).toBe('about:blank')
  })

  test('refuses file:// (local file read)', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBe('about:blank')
    expect(normalizeUrl('FILE://localhost/etc/passwd')).toBe('about:blank')
  })

  test('refuses other privileged schemes', () => {
    expect(normalizeUrl('chrome://settings')).toBe('about:blank')
    expect(normalizeUrl('devtools://devtools/bundled/x')).toBe('about:blank')
  })

  test('still upgrades bare domains and routes searches', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('how to center a div')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/)
    // host:port without a scheme is not a scheme — treated as a domain.
    expect(normalizeUrl('localhost:5173')).toBe('https://duckduckgo.com/?q=localhost%3A5173')
  })

  test('javascript: with no // becomes a harmless search, never a navigation', () => {
    expect(normalizeUrl('javascript:alert(1)')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/)
  })
})
