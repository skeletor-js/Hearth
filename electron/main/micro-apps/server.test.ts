import { test, expect, describe } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractDevUrl, installDeps, startMicroApp } from './server'

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

describe('startMicroApp name validation', () => {
  test('rejects a traversal name before spawning anything', async () => {
    await expect(startMicroApp('/repo', '../../etc')).rejects.toThrow(/invalid app name/i)
    await expect(startMicroApp('/repo', 'has spaces')).rejects.toThrow(/invalid app name/i)
  })
})

describe('installDeps (lifecycle-script containment, W4)', () => {
  // A micro-app's package.json is agent-authored and untrusted. Its lifecycle
  // scripts would run in the main process, so installDeps must pass
  // --ignore-scripts. Hermetic: no dependencies → no network.
  test('does not run a postinstall script during install', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-microapp-w4-'))
    try {
      const sentinel = join(dir, 'PWNED')
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'evil',
          version: '0.0.0',
          private: true,
          scripts: { postinstall: `node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, '\\\\')}','x')"` },
        }),
      )

      await installDeps(dir)

      expect(existsSync(sentinel)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
