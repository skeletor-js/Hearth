import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type CryptoBackend } from './secret-store.js'

// A reversible fake "encryption": prefix-tag + base64 so we can assert the file
// never contains plaintext and that decrypt round-trips.
const fakeBackend = (available = true): CryptoBackend => ({
  available,
  encrypt: (plain) => Buffer.from('ENC:' + Buffer.from(plain, 'utf8').toString('base64'), 'utf8'),
  decrypt: (blob) => {
    const s = blob.toString('utf8')
    if (!s.startsWith('ENC:')) throw new Error('bad blob')
    return Buffer.from(s.slice(4), 'base64').toString('utf8')
  },
})

const dirs: string[] = []
const tmpFile = () => {
  const d = mkdtempSync(join(tmpdir(), 'hearth-secrets-'))
  dirs.push(d)
  return join(d, 'secrets.json')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('SecretStore', () => {
  test('set/get/has/delete round-trip', () => {
    const s = new SecretStore(tmpFile(), fakeBackend())
    expect(s.get('apikey.anthropic')).toBeUndefined()
    s.set('apikey.anthropic', 'sk-ant-123')
    expect(s.get('apikey.anthropic')).toBe('sk-ant-123')
    expect(s.has('apikey.anthropic')).toBe(true)
    s.delete('apikey.anthropic')
    expect(s.get('apikey.anthropic')).toBeUndefined()
    expect(s.has('apikey.anthropic')).toBe(false)
  })

  test('list returns names + presence only, sorted, never values', () => {
    const s = new SecretStore(tmpFile(), fakeBackend())
    s.set('mcp.foo.TOKEN', 'secret-token')
    s.set('apikey.openai', 'sk-oai')
    const list = s.list()
    expect(list).toEqual([
      { key: 'apikey.openai', hasValue: true },
      { key: 'mcp.foo.TOKEN', hasValue: true },
    ])
    // No value leaks through the listing.
    expect(JSON.stringify(list)).not.toContain('secret-token')
  })

  test('persists across instances (reload)', () => {
    const file = tmpFile()
    new SecretStore(file, fakeBackend()).set('apikey.anthropic', 'sk-ant-xyz')
    const reopened = new SecretStore(file, fakeBackend())
    expect(reopened.get('apikey.anthropic')).toBe('sk-ant-xyz')
  })

  test('on-disk file never contains the plaintext value when encrypted', () => {
    const file = tmpFile()
    const s = new SecretStore(file, fakeBackend(true))
    s.set('apikey.anthropic', 'PLAINTEXT-SECRET')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('PLAINTEXT-SECRET')
    expect(JSON.parse(raw).enc).toBe(true)
  })

  test('encryption-unavailable path still works but marks file unencrypted', () => {
    const file = tmpFile()
    const s = new SecretStore(file, fakeBackend(false))
    expect(s.encryptionAvailable).toBe(false)
    s.set('apikey.openai', 'k')
    expect(s.get('apikey.openai')).toBe('k')
    expect(JSON.parse(readFileSync(file, 'utf8')).enc).toBe(false)
    expect(new SecretStore(file, fakeBackend(false)).get('apikey.openai')).toBe('k')
  })

  test('empty key is rejected', () => {
    const s = new SecretStore(tmpFile(), fakeBackend())
    expect(() => s.set('', 'x')).toThrow()
  })

  test('corrupt file loads empty instead of throwing', () => {
    const file = tmpFile()
    const s = new SecretStore(file, fakeBackend())
    s.set('a', '1')
    // Clobber with garbage, then reopen.
    writeFileSync(file, 'not json{')
    const reopened = new SecretStore(file, fakeBackend())
    expect(reopened.list()).toEqual([])
  })

  test('does not write a file until first set', () => {
    const file = tmpFile()
    new SecretStore(file, fakeBackend())
    expect(existsSync(file)).toBe(false)
  })
})
