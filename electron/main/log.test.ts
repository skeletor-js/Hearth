import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from './log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('createLogger', () => {
  test('writes a level-tagged line to the expected path', () => {
    const logger = createLogger(join(dir, 'Logs'))
    logger.error('boom:', new Error('it broke'))
    const text = readFileSync(logger.file, 'utf8')
    expect(logger.file).toBe(join(dir, 'Logs', 'main.log'))
    expect(text).toContain('[error] boom: Error: it broke')
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO timestamp prefix
  })

  test('rotates past the size cap, keeping one prior file', () => {
    const logs = join(dir, 'Logs')
    const logger = createLogger(logs, { maxBytes: 200 })
    writeFileSync(logger.file, 'x'.repeat(300)) // already over the cap
    logger.info('first line after cap')
    expect(readFileSync(join(logs, 'main.log.1'), 'utf8')).toContain('xxx')
    const fresh = readFileSync(logger.file, 'utf8')
    expect(fresh).toContain('first line after cap')
    expect(fresh.length).toBeLessThan(200)
  })

  test('a missing log dir is created; logging never throws', () => {
    const logger = createLogger(join(dir, 'deep', 'nested', 'Logs'))
    logger.info('hello')
    expect(existsSync(logger.file)).toBe(true)
  })
})
