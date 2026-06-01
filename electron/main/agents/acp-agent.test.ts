import { test, expect, describe } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolveAdapterBin } from './acp-agent.js'

// Guards the packaging assumption both backends depend on: the adapter package
// is installed and its bin resolves to a real file. (A wrong bin key / missing
// dep is exactly the runtime-only failure that bit the Claude path before.)
describe('resolveAdapterBin', () => {
  test('resolves the Claude adapter bin to a real file', () => {
    const bin = resolveAdapterBin('@zed-industries/claude-agent-acp', 'claude-agent-acp')
    expect(existsSync(bin)).toBe(true)
  })

  test('resolves the Codex adapter bin to a real file', () => {
    const bin = resolveAdapterBin('@agentclientprotocol/codex-acp', 'codex-acp')
    expect(existsSync(bin)).toBe(true)
  })

  test('throws a clear error when the bin name is unknown', () => {
    expect(() => resolveAdapterBin('@agentclientprotocol/codex-acp', 'not-a-bin')).toThrow(/no bin/)
  })
})
