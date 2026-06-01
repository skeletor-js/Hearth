#!/usr/bin/env node
// A tiny stdio MCP server that gives the agent a first-class `view_app` tool:
// call it (optionally with a route) and get back a PNG of the live Hearth window.
//
// It's spawned by the ACP adapter (see electron/main/agents/acp-client.ts, which
// passes it in newSession's mcpServers). It bridges to Hearth's main process via
// the loopback snapshot endpoint (HEARTH_SNAPSHOT_URL); main is the only process
// that can capture the real rendered frame.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const SNAPSHOT_URL = process.env.HEARTH_SNAPSHOT_URL

const server = new McpServer({ name: 'hearth-view', version: '0.1.0' })

server.registerTool(
  'view_app',
  {
    title: 'View the live Hearth app',
    description:
      'Capture a screenshot of the live, running Hearth window so you can visually verify your UI work. ' +
      'Optionally pass a route path (e.g. "/history", "/chat", "/micro/demo") to navigate there first. ' +
      'Returns a PNG image of the current rendered app.',
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe('Route to navigate to before capturing, e.g. "/history". Omit to capture the current view.'),
    },
  },
  async ({ path }) => {
    if (!SNAPSHOT_URL) {
      return { isError: true, content: [{ type: 'text', text: 'HEARTH_SNAPSHOT_URL is not set; is Hearth running?' }] }
    }
    const url = path ? `${SNAPSHOT_URL}?path=${encodeURIComponent(path)}` : SNAPSHOT_URL
    try {
      const res = await fetch(url)
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: `Snapshot failed: HTTP ${res.status}` }] }
      }
      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return {
        content: [
          { type: 'text', text: path ? `Live view of ${path}:` : 'Live view of the current screen:' },
          { type: 'image', data, mimeType: 'image/png' },
        ],
      }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Could not reach Hearth: ${err.message}` }] }
    }
  },
)

await server.connect(new StdioServerTransport())
