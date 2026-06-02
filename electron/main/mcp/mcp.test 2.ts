import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpRegistry, type McpServerInput } from './registry.js'
import { toAcpServers } from './to-acp.js'

const dirs: string[] = []
const tmpFile = () => {
  const d = mkdtempSync(join(tmpdir(), 'hearth-mcp-'))
  dirs.push(d)
  return join(d, 'mcp-servers.json')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const stdioInput = (name: string): McpServerInput => ({
  name,
  enabled: true,
  transport: { type: 'stdio', command: 'my-server', args: ['--flag'] },
  env: [],
})

describe('McpRegistry', () => {
  test('add assigns an id and persists', () => {
    const file = tmpFile()
    const reg = new McpRegistry(file)
    const s = reg.add(stdioInput('Foo'))
    expect(s.id).toBeTruthy()
    expect(new McpRegistry(file).list()).toHaveLength(1)
  })

  test('update patches fields but keeps id', () => {
    const reg = new McpRegistry(tmpFile())
    const s = reg.add(stdioInput('Foo'))
    const updated = reg.update(s.id, { name: 'Bar' })
    expect(updated?.id).toBe(s.id)
    expect(updated?.name).toBe('Bar')
  })

  test('setEnabled + remove', () => {
    const reg = new McpRegistry(tmpFile())
    const s = reg.add(stdioInput('Foo'))
    reg.setEnabled(s.id, false)
    expect(reg.get(s.id)?.enabled).toBe(false)
    reg.remove(s.id)
    expect(reg.list()).toHaveLength(0)
  })

  test('list returns copies (no external mutation of internal env)', () => {
    const reg = new McpRegistry(tmpFile())
    const s = reg.add({ ...stdioInput('Foo'), env: [{ name: 'TOKEN', secretKey: 'mcp.foo.TOKEN' }] })
    const list = reg.list()
    list[0].env[0].name = 'MUTATED'
    expect(reg.get(s.id)?.env[0].name).toBe('TOKEN')
  })
})

describe('toAcpServers', () => {
  const secrets = (m: Record<string, string>) => ({ get: (k: string) => m[k] })

  test('maps stdio with resolved secret env', () => {
    const cfg = {
      id: '1',
      name: 'Foo',
      enabled: true,
      transport: { type: 'stdio' as const, command: 'foo', args: ['-x'] },
      env: [{ name: 'TOKEN', secretKey: 'mcp.foo.TOKEN' }],
    }
    const { servers, skipped } = toAcpServers([cfg], secrets({ 'mcp.foo.TOKEN': 'sekret' }))
    expect(skipped).toHaveLength(0)
    expect(servers[0]).toEqual({ name: 'Foo', command: 'foo', args: ['-x'], env: [{ name: 'TOKEN', value: 'sekret' }] })
  })

  test('drops disabled servers', () => {
    const cfg = {
      id: '1',
      name: 'Off',
      enabled: false,
      transport: { type: 'stdio' as const, command: 'foo', args: [] },
      env: [],
    }
    expect(toAcpServers([cfg], secrets({})).servers).toHaveLength(0)
  })

  test('skips enabled server with a missing secret rather than launching it bare', () => {
    const cfg = {
      id: '1',
      name: 'NeedsToken',
      enabled: true,
      transport: { type: 'stdio' as const, command: 'foo', args: [] },
      env: [{ name: 'TOKEN', secretKey: 'mcp.foo.TOKEN' }],
    }
    const { servers, skipped } = toAcpServers([cfg], secrets({}))
    expect(servers).toHaveLength(0)
    expect(skipped).toEqual([{ name: 'NeedsToken', missing: ['mcp.foo.TOKEN'] }])
  })

  test('maps http transport to headers with a type discriminator', () => {
    const cfg = {
      id: '1',
      name: 'Remote',
      enabled: true,
      transport: { type: 'http' as const, url: 'https://example.com/mcp' },
      env: [{ name: 'Authorization', value: 'Bearer xyz' }],
    }
    const { servers } = toAcpServers([cfg], secrets({}))
    expect(servers[0]).toEqual({
      type: 'http',
      name: 'Remote',
      url: 'https://example.com/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer xyz' }],
    })
  })
})
