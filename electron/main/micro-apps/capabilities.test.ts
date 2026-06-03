import { test, expect, describe } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityStore, normalizeHost, readManifest } from './capabilities'

describe('normalizeHost', () => {
  test('accepts a plain https origin', () => {
    expect(normalizeHost('https://www.googleapis.com')).toBe('https://www.googleapis.com')
  })

  test('strips a trailing path to the origin only when path is "/"', () => {
    expect(normalizeHost('https://api.example.com/')).toBe('https://api.example.com')
  })

  test('lowercases the host', () => {
    expect(normalizeHost('https://API.Example.COM')).toBe('https://api.example.com')
  })

  test('keeps an explicit port in the origin', () => {
    expect(normalizeHost('https://api.example.com:8443')).toBe('https://api.example.com:8443')
  })

  test('rejects http (plaintext)', () => {
    expect(normalizeHost('http://example.com')).toBeNull()
  })

  test('rejects a host with a path', () => {
    expect(normalizeHost('https://example.com/v1/data')).toBeNull()
  })

  test('rejects wildcards', () => {
    expect(normalizeHost('https://*.example.com')).toBeNull()
  })

  test('rejects embedded credentials', () => {
    expect(normalizeHost('https://user:pass@example.com')).toBeNull()
  })

  test('rejects loopback and unspecified hosts', () => {
    expect(normalizeHost('https://localhost')).toBeNull()
    expect(normalizeHost('https://127.0.0.1')).toBeNull()
    expect(normalizeHost('https://0.0.0.0')).toBeNull()
  })

  test('rejects bare single-label hostnames', () => {
    expect(normalizeHost('https://intranet')).toBeNull()
  })

  test('rejects junk', () => {
    expect(normalizeHost('not a url')).toBeNull()
    expect(normalizeHost('')).toBeNull()
  })
})

describe('readManifest', () => {
  function withRepo(fn: (repoRoot: string) => void): void {
    const repo = mkdtempSync(join(tmpdir(), 'hearth-caps-'))
    try {
      fn(repo)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }

  function writeManifest(repo: string, name: string, content: string): void {
    const dir = join(repo, 'micro-apps', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'hearth.app.json'), content)
  }

  test('returns [] when no manifest exists', () => {
    withRepo((repo) => expect(readManifest(repo, 'demo')).toEqual([]))
  })

  test('reads valid host requests with reasons', () => {
    withRepo((repo) => {
      writeManifest(
        repo,
        'inbox',
        JSON.stringify({ hosts: [{ host: 'https://www.googleapis.com', reason: 'Gmail API' }] }),
      )
      expect(readManifest(repo, 'inbox')).toEqual([
        { host: 'https://www.googleapis.com', reason: 'Gmail API' },
      ])
    })
  })

  test('drops invalid hosts and dedupes', () => {
    withRepo((repo) => {
      writeManifest(
        repo,
        'inbox',
        JSON.stringify({
          hosts: [
            { host: 'http://insecure.com', reason: 'no' },
            { host: 'https://a.com', reason: 'one' },
            { host: 'https://a.com/', reason: 'dup' },
          ],
        }),
      )
      expect(readManifest(repo, 'inbox')).toEqual([{ host: 'https://a.com', reason: 'one' }])
    })
  })

  test('never throws on malformed JSON', () => {
    withRepo((repo) => {
      writeManifest(repo, 'inbox', '{ not json')
      expect(readManifest(repo, 'inbox')).toEqual([])
    })
  })
})

describe('CapabilityStore', () => {
  function withStore(fn: (store: CapabilityStore, repo: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-capstore-'))
    try {
      fn(new CapabilityStore(join(dir, 'capabilities.json')), dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test('a fresh app has no approved hosts', () => {
    withStore((store) => expect(store.approved('demo')).toEqual([]))
  })

  test('approve adds normalized hosts, scoped per app', () => {
    withStore((store) => {
      store.approve('inbox', ['https://www.googleapis.com'])
      expect(store.approved('inbox')).toEqual(['https://www.googleapis.com'])
      // A different app gets nothing.
      expect(store.approved('other')).toEqual([])
    })
  })

  test('approve ignores invalid hosts', () => {
    withStore((store) => {
      store.approve('inbox', ['http://insecure.com', 'https://ok.com'])
      expect(store.approved('inbox')).toEqual(['https://ok.com'])
    })
  })

  test('revoke removes a host; revoke-all clears the app', () => {
    withStore((store) => {
      store.approve('inbox', ['https://a.com', 'https://b.com'])
      store.revoke('inbox', 'https://a.com')
      expect(store.approved('inbox')).toEqual(['https://b.com'])
      store.revoke('inbox')
      expect(store.approved('inbox')).toEqual([])
    })
  })

  test('approve/revoke/readManifest reject an invalid app name', () => {
    withStore((store) => {
      expect(() => store.approve('../../x', ['https://a.com'])).toThrow(/invalid app name/i)
      expect(() => store.revoke('../../x')).toThrow(/invalid app name/i)
    })
    // assertAppName fires before any filesystem access, so repoRoot is irrelevant.
    expect(() => readManifest('/repo', '../../x')).toThrow(/invalid app name/i)
  })

  test('capabilities() splits approved vs pending from the manifest', () => {
    withStore((store, repo) => {
      const dir = join(repo, 'micro-apps', 'inbox')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'hearth.app.json'),
        JSON.stringify({
          hosts: [
            { host: 'https://approved.com', reason: 'a' },
            { host: 'https://pending.com', reason: 'b' },
          ],
        }),
      )
      store.approve('inbox', ['https://approved.com'])
      const caps = store.capabilities(repo, 'inbox')
      expect(caps.approved).toEqual(['https://approved.com'])
      expect(caps.pending).toEqual([{ host: 'https://pending.com', reason: 'b' }])
    })
  })

  test('persists across instances', () => {
    withStore((store, repo) => {
      store.approve('inbox', ['https://a.com'])
      const reopened = new CapabilityStore(join(repo, 'capabilities.json'))
      expect(reopened.approved('inbox')).toEqual(['https://a.com'])
    })
  })
})
