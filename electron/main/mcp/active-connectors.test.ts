import { test, expect, describe } from 'bun:test'
import { parseClaudeConnectors, parseCodexConnectors } from './active-connectors'

describe('parseClaudeConnectors', () => {
  test('reads user, local, and project scopes with transport + auth presence', () => {
    const root = {
      mcpServers: {
        notion: { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer secret' } },
        local_tool: { command: 'npx', args: ['-y', 'thing'] },
      },
      projects: {
        '/repo': { mcpServers: { scoped: { type: 'sse', url: 'https://x/sse' } } },
        '/other': { mcpServers: { ignored: { command: 'nope' } } },
      },
    }
    const projectServers = { fromMcpJson: { url: 'https://y/mcp', env: { K: 'v' } } }
    const out = parseClaudeConnectors(root, '/repo', projectServers)

    expect(out.find((c) => c.name === 'notion')).toEqual({
      name: 'notion',
      scope: 'user',
      transport: 'http',
      target: 'https://mcp.notion.com/mcp',
      hasAuth: true,
    })
    // stdio inferred when no url/type; no auth
    expect(out.find((c) => c.name === 'local_tool')).toMatchObject({ scope: 'user', transport: 'stdio', hasAuth: false })
    // local scope from projects[cwd]; the other project is not included
    expect(out.find((c) => c.name === 'scoped')).toMatchObject({ scope: 'local', transport: 'sse' })
    expect(out.find((c) => c.name === 'ignored')).toBeUndefined()
    // project scope from .mcp.json; env counts as auth
    expect(out.find((c) => c.name === 'fromMcpJson')).toMatchObject({ scope: 'project', transport: 'http', hasAuth: true })
  })

  test('empty / missing config yields no connectors', () => {
    expect(parseClaudeConnectors({}, '/repo')).toEqual([])
  })
})

describe('parseCodexConnectors', () => {
  test('reads [mcp_servers.*] tables, infers transport, detects auth', () => {
    const toml = `
model = "o3"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"
transport = "http"

[mcp_servers.docs]
command = "npx"
args = ["-y", "@some/mcp"]

[mcp_servers.secured]
url = "https://x/mcp"  # inline comment
[mcp_servers.secured.env]
TOKEN = "shh"

[some_other_table]
url = "https://not-a-connector"
`
    const out = parseCodexConnectors(toml)
    expect(out.find((c) => c.name === 'notion')).toEqual({
      name: 'notion',
      scope: 'user',
      transport: 'http',
      target: 'https://mcp.notion.com/mcp',
      hasAuth: false,
    })
    expect(out.find((c) => c.name === 'docs')).toMatchObject({ transport: 'stdio', target: 'npx', hasAuth: false })
    // nested [mcp_servers.secured.env] table marks auth present; comment stripped
    expect(out.find((c) => c.name === 'secured')).toMatchObject({
      transport: 'http',
      target: 'https://x/mcp',
      hasAuth: true,
    })
    // keys under an unrelated table are not attributed to a connector
    expect(out.some((c) => c.target === 'https://not-a-connector')).toBe(false)
  })

  test('nested [mcp_servers.<name>.env] is a subtable, not a phantom server', () => {
    const toml = `
[mcp_servers.node_repl]
command = "node"

[mcp_servers.node_repl.env]
NODE_OPTIONS = "--x"
`
    const out = parseCodexConnectors(toml)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'node_repl', transport: 'stdio', hasAuth: true })
    expect(out.some((c) => c.name === 'node_repl.env')).toBe(false)
  })

  test('empty config yields no connectors', () => {
    expect(parseCodexConnectors('')).toEqual([])
  })
})
