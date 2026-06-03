import { test, expect } from 'bun:test'
import { probeServer } from './probe'
import type { McpServerConfig } from './registry'

// A fake stdio MCP server that answers `initialize` with a JSON-RPC error frame.
const ERROR_SERVER = `
let b = '';
process.stdin.on('data', (d) => {
  b += d;
  let i;
  while ((i = b.indexOf('\\n')) !== -1) {
    const line = b.slice(0, i); b = b.slice(i + 1);
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.id === 1) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'unsupported protocol version' } }) + '\\n');
    }
  }
});
`

test('reports a JSON-RPC error to initialize instead of timing out', async () => {
  const config: McpServerConfig = {
    id: 'fake',
    name: 'Fake',
    enabled: true,
    transport: { type: 'stdio', command: process.execPath, args: ['-e', ERROR_SERVER] },
    env: [],
  }
  const start = performance.now()
  const r = await probeServer(config, { get: () => undefined })
  // Resolved well under the 8s probe timeout — proving it acted on the error.
  expect(performance.now() - start).toBeLessThan(4000)
  expect(r.ok).toBe(false)
  expect(r.error).toContain('unsupported protocol version')
}, 10_000)
