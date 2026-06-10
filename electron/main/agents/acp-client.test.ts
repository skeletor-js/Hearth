import { test, expect, describe } from 'bun:test'
import { AcpAgent } from './acp-agent.js'

// A minimal ACP adapter: answers initialize over ndjson stdio, then either
// stays alive or self-destructs after a beat — enough real process lifecycle
// to exercise the U5 exit wiring without a real backend.
const fakeAdapter = (opts: { dieAfterMs?: number; exitCode?: number } = {}): string => `
  process.stdin.setEncoding('utf8')
  let buf = ''
  process.stdin.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: msg.params.protocolVersion, agentCapabilities: {}, authMethods: [] },
        }) + '\\n')
      }
    }
  })
  ${opts.dieAfterMs ? `setTimeout(() => process.exit(${opts.exitCode ?? 7}), ${opts.dieAfterMs})` : 'setInterval(() => {}, 1000)'}
`

const specFor = (script: string) => () => ({ command: process.execPath, args: ['-e', script], cwd: process.cwd() })

// Driven through AcpAgent (the production wrapper), not AcpClient directly, so
// the onExit delegation is part of what's under test — a missing pass-through
// made host registration silently no-op in the live app.

describe('AcpClient exit wiring (U5)', () => {
  test('an unexpected adapter death fires onExit with the exit code', async () => {
    const client = new AcpAgent('claude', specFor(fakeAdapter({ dieAfterMs: 150, exitCode: 7 })))
    const exits: Array<{ code: number | null; signal: string | null }> = []
    client.onExit((info) => exits.push(info))
    await client.connect()

    await new Promise((r) => setTimeout(r, 600))
    expect(exits).toEqual([{ code: 7, signal: null }])
    await client.dispose()
  })

  test('a deliberate dispose() never fires onExit', async () => {
    const client = new AcpAgent('claude', specFor(fakeAdapter()))
    const exits: unknown[] = []
    client.onExit((info) => exits.push(info))
    await client.connect()

    await client.dispose()
    await new Promise((r) => setTimeout(r, 300)) // give the killed child time to exit
    expect(exits).toEqual([])
  })
})
