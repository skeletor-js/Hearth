import { test, expect, describe } from 'bun:test'
import { buildMicroAppCsp, buildShellCsp } from './session-policy'

describe('buildMicroAppCsp', () => {
  test('an ungranted app reaches only self, its own HMR socket, and the broker', () => {
    const csp = buildMicroAppCsp('http://localhost:5183', [], 'http://127.0.0.1:49210')
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))
    expect(connect).toBe("connect-src 'self' ws://localhost:5183 http://127.0.0.1:49210")
    // No external host is reachable.
    expect(connect).not.toContain('https://')
  })

  test('a granted app gets exactly its approved hosts added', () => {
    const csp = buildMicroAppCsp('http://localhost:5183', ['https://www.googleapis.com'], 'http://127.0.0.1:49210')
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))!
    expect(connect).toContain('https://www.googleapis.com')
    expect(connect).not.toContain('https://evil.com')
  })

  test('omits the broker when it is not running', () => {
    const csp = buildMicroAppCsp('http://localhost:5183', [], null)
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))!
    expect(connect).toBe("connect-src 'self' ws://localhost:5183")
  })

  test('never sets a connect-src floor looser than self for an ungranted app', () => {
    const csp = buildMicroAppCsp('http://localhost:5200', [], null)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
  })
})

describe('buildShellCsp', () => {
  test('forbids the shell from being framed', () => {
    expect(buildShellCsp()).toContain("frame-ancestors 'none'")
  })

  test('allows framing localhost micro-apps', () => {
    expect(buildShellCsp()).toContain('frame-src http://localhost:* http://127.0.0.1:*')
  })
})
