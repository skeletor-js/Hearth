import { test, expect, describe } from 'bun:test'
import { extractDevUrl } from './server'

describe('extractDevUrl', () => {
  test('matches a plain localhost URL with trailing slash', () => {
    expect(extractDevUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  test('matches a 127.0.0.1 URL without trailing slash', () => {
    expect(extractDevUrl('http://127.0.0.1:5174')).toBe('http://127.0.0.1:5174')
  })

  test('matches inside a typical vite "Local:" line', () => {
    const line = '  ➜  Local:   http://localhost:5173/'
    expect(extractDevUrl(line)).toBe('http://localhost:5173/')
  })

  test('matches when wrapped in ANSI color codes', () => {
    const line = '  \x1b[32m➜\x1b[0m  Local: \x1b[36mhttp://localhost:5180/\x1b[0m'
    expect(extractDevUrl(line)).toBe('http://localhost:5180/')
  })

  test('matches https as well as http', () => {
    expect(extractDevUrl('  ➜  Local: https://localhost:5173/')).toBe('https://localhost:5173/')
  })

  test('returns null when no URL is present', () => {
    expect(extractDevUrl('VITE v6.0.0  ready in 312 ms')).toBeNull()
  })

  test('returns null for empty input', () => {
    expect(extractDevUrl('')).toBeNull()
  })

  test('ignores non-loopback hosts', () => {
    expect(extractDevUrl('http://example.com:5173/')).toBeNull()
  })
})
