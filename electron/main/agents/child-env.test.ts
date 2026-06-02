import { test, expect, describe } from 'bun:test'
import { buildChildEnv, shouldScrubInheritedKeys, INHERITED_CREDENTIAL_VARS } from './child-env.js'

describe('buildChildEnv', () => {
  test('passes the base env through and merges extra over it (no scrub)', () => {
    const env = buildChildEnv({ PATH: '/usr/bin', FOO: 'bar' }, { ELECTRON_RUN_AS_NODE: '1' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.FOO).toBe('bar')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  test('without scrub, inherited credential vars survive', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'leaked', ANTHROPIC_BASE_URL: 'http://gw' })
    expect(env.ANTHROPIC_API_KEY).toBe('leaked')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://gw')
  })

  test('scrub removes every inherited credential var from the base', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    for (const k of INHERITED_CREDENTIAL_VARS) base[k] = 'inherited'
    const env = buildChildEnv(base, {}, { scrubInheritedKeys: true })
    for (const k of INHERITED_CREDENTIAL_VARS) expect(env[k]).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin') // unrelated vars untouched
  })

  test('a BYO key in extra wins over a scrubbed inherited key', () => {
    const env = buildChildEnv(
      { ANTHROPIC_API_KEY: 'leaked-from-parent' },
      { ANTHROPIC_API_KEY: 'users-own-key' },
      { scrubInheritedKeys: true },
    )
    expect(env.ANTHROPIC_API_KEY).toBe('users-own-key')
  })

  test('scrub with no extra leaves the credential unset (subscription/login path)', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'leaked' }, {}, { scrubInheritedKeys: true })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('does not mutate the base env object', () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'leaked' }
    buildChildEnv(base, {}, { scrubInheritedKeys: true })
    expect(base.ANTHROPIC_API_KEY).toBe('leaked')
  })
})

describe('shouldScrubInheritedKeys', () => {
  test('true only when the flag is exactly "1"', () => {
    expect(shouldScrubInheritedKeys({ HEARTH_SCRUB_INHERITED_KEYS: '1' })).toBe(true)
    expect(shouldScrubInheritedKeys({ HEARTH_SCRUB_INHERITED_KEYS: 'true' })).toBe(false)
    expect(shouldScrubInheritedKeys({})).toBe(false)
  })
})
