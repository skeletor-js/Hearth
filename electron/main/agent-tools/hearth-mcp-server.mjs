#!/usr/bin/env node
// The Hearth MCP server: gives the agent tools to SEE and CONTROL the live app —
// anything the user could do. Spawned by the ACP adapter (see
// electron/main/agents/acp-client.ts) and bridges to Hearth's main process via the
// loopback bridge (HEARTH_BRIDGE_URL): /snapshot for pixels, /eval to run JS in the
// live renderer (DOM + window.hearth). Every tool call is permission-gated by the
// adapter, so the user stays in the loop.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BRIDGE = process.env.HEARTH_BRIDGE_URL

function noBridge() {
  return { isError: true, content: [{ type: 'text', text: 'HEARTH_BRIDGE_URL not set; is Hearth running?' }] }
}

// Run JS in the live renderer and return its (JSON-serializable) result.
async function evalInApp(code) {
  const res = await fetch(`${BRIDGE}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(`bridge /eval HTTP ${res.status}`)
  const out = await res.json()
  if (!out.ok) throw new Error(out.error || 'eval failed')
  return out.result
}

const textResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const errResult = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] })

const server = new McpServer({ name: 'hearth', version: '0.1.0' })

// ─── SEE ────────────────────────────────────────────────────────────────────
server.registerTool(
  'view_app',
  {
    title: 'Screenshot the live Hearth app',
    description:
      'Capture a PNG of the live app so you can visually verify your work. Optionally pass a route ' +
      '(e.g. "/history", "/chat", "/micro/demo") to render+capture that screen in a hidden window without ' +
      "disturbing the user's current view. No path captures what the user currently sees.",
    inputSchema: { path: z.string().optional().describe('Route to render+capture, e.g. "/history". Omit for the current view.') },
  },
  async ({ path }) => {
    if (!BRIDGE) return noBridge()
    try {
      const url = path ? `${BRIDGE}/snapshot?path=${encodeURIComponent(path)}` : `${BRIDGE}/snapshot`
      const res = await fetch(url)
      if (!res.ok) return errResult(new Error(`snapshot HTTP ${res.status}`))
      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return {
        content: [
          { type: 'text', text: path ? `Live view of ${path}:` : 'Live view of the current screen:' },
          { type: 'image', data, mimeType: 'image/png' },
        ],
      }
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'read_ui',
  {
    title: 'Read the interactive elements on screen',
    description:
      'List the interactive elements (buttons, links, inputs) currently rendered, with their visible text and a ' +
      'CSS selector. Use this to find what to click/fill. Pairs with view_app (pixels) — this is the actionable text view.',
    inputSchema: {},
  },
  async () => {
    if (!BRIDGE) return noBridge()
    const code = `(() => {
      const cssPath = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 5) {
          let part = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const sibs = [...parent.children].filter(c => c.tagName === node.tagName);
            if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };
      const els = [...document.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="link"]')];
      return els.filter(el => el.offsetParent !== null || el === document.activeElement).slice(0, 80).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        selector: cssPath(el),
      }));
    })()`
    try {
      return textResult(await evalInApp(code))
    } catch (e) {
      return errResult(e)
    }
  },
)

// ─── CONTROL ──────────────────────────────────────────────────────────────────
server.registerTool(
  'click',
  {
    title: 'Click an element',
    description:
      'Click an element in the live app. Target it by CSS `selector` or by visible `text` (matches a ' +
      'button/link whose text equals, then contains, the string). Use read_ui to discover targets.',
    inputSchema: {
      selector: z.string().optional().describe('CSS selector to click.'),
      text: z.string().optional().describe('Visible text of a button/link to click (used if selector is omitted).'),
    },
  },
  async ({ selector, text }) => {
    if (!BRIDGE) return noBridge()
    if (!selector && !text) return errResult(new Error('provide selector or text'))
    const code = `((sel, txt) => {
      let el = null;
      if (sel) el = document.querySelector(sel);
      else {
        const norm = s => (s || '').trim().toLowerCase();
        const cands = [...document.querySelectorAll('button, a, [role="button"], [role="link"]')];
        el = cands.find(e => norm(e.innerText) === norm(txt)) || cands.find(e => norm(e.innerText).includes(norm(txt)));
      }
      if (!el) return { clicked: false, reason: 'not found' };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { clicked: true, text: (el.innerText || '').trim().slice(0, 80) };
    })(${JSON.stringify(selector ?? null)}, ${JSON.stringify(text ?? null)})`
    try {
      return textResult(await evalInApp(code))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'fill',
  {
    title: 'Type into an input',
    description:
      'Set the value of an input/textarea (React-controlled inputs handled correctly) in the live app. ' +
      'Pass a CSS `selector` and the `value`. Optionally `submit: true` to press Enter afterward.',
    inputSchema: {
      selector: z.string().describe('CSS selector of the input/textarea.'),
      value: z.string().describe('Text to set.'),
      submit: z.boolean().optional().describe('Press Enter after filling.'),
    },
  },
  async ({ selector, value, submit }) => {
    if (!BRIDGE) return noBridge()
    const code = `((sel, val, submit) => {
      const el = document.querySelector(sel);
      if (!el) return { filled: false, reason: 'not found' };
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.focus();
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
      }
      return { filled: true };
    })(${JSON.stringify(selector)}, ${JSON.stringify(value)}, ${JSON.stringify(!!submit)})`
    try {
      return textResult(await evalInApp(code))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'eval_js',
  {
    title: 'Run JavaScript in the live app',
    description:
      'Escape hatch: run arbitrary JavaScript in the live renderer and return its JSON-serializable result. The ' +
      'code runs in the page context — it has the DOM and `window.hearth` (every IPC: agent.prompt, selfMod.undo, ' +
      'microApps.start/stop, agent.setBackend, etc.). Make the final expression return something serializable.',
    inputSchema: { code: z.string().describe('JavaScript to evaluate in the renderer.') },
  },
  async ({ code }) => {
    if (!BRIDGE) return noBridge()
    try {
      return textResult(await evalInApp(code))
    } catch (e) {
      return errResult(e)
    }
  },
)

// ─── BROWSER (the same persistent, logged-in browser the user uses) ───────────
// These drive the embedded WebContentsView via the bridge's /browser/* endpoints,
// so the agent acts inside the user's authenticated sessions. Works on any backend.
async function browserCall(action, { method = 'POST', body } = {}) {
  const res = await fetch(`${BRIDGE}/browser/${action}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  })
  if (!res.ok) throw new Error(`bridge /browser/${action} HTTP ${res.status}`)
  const out = await res.json()
  if (out.ok === false) throw new Error(out.error || `${action} failed`)
  return out.result ?? out
}

server.registerTool(
  'browser_navigate',
  {
    title: 'Navigate the embedded browser',
    description:
      'Navigate the embedded browser (a real, persistent Chromium the user also uses and logs into) to a URL. ' +
      'A bare domain is upgraded to https; non-URL text becomes a search.',
    inputSchema: { url: z.string().describe('URL or search query.') },
  },
  async ({ url }) => {
    if (!BRIDGE) return noBridge()
    try {
      await browserCall('navigate', { body: { url } })
      return textResult(await browserCall('read'))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'browser_read',
  {
    title: 'Read the embedded browser page',
    description:
      "Return the current page's URL, title, and visible text (truncated). Use to read content — including pages " +
      'behind the user’s login, since it’s the same authenticated browser.',
    inputSchema: {},
  },
  async () => {
    if (!BRIDGE) return noBridge()
    try {
      return textResult(await browserCall('read'))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'browser_screenshot',
  {
    title: 'Screenshot the embedded browser',
    description: 'Capture a PNG of the current embedded-browser page.',
    inputSchema: {},
  },
  async () => {
    if (!BRIDGE) return noBridge()
    try {
      const res = await fetch(`${BRIDGE}/browser/screenshot`)
      if (!res.ok) return errResult(new Error(`screenshot HTTP ${res.status}`))
      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return { content: [{ type: 'text', text: 'Embedded browser:' }, { type: 'image', data, mimeType: 'image/png' }] }
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'browser_click',
  {
    title: 'Click in the embedded browser',
    description: 'Click the first element matching a CSS selector on the current page.',
    inputSchema: { selector: z.string().describe('CSS selector to click.') },
  },
  async ({ selector }) => {
    if (!BRIDGE) return noBridge()
    try {
      return textResult(await browserCall('click', { body: { selector } }))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'browser_fill',
  {
    title: 'Fill an input in the embedded browser',
    description: 'Set the value of an input/textarea matching a CSS selector on the current page.',
    inputSchema: { selector: z.string().describe('CSS selector.'), value: z.string().describe('Value to set.') },
  },
  async ({ selector, value }) => {
    if (!BRIDGE) return noBridge()
    try {
      return textResult(await browserCall('fill', { body: { selector, value } }))
    } catch (e) {
      return errResult(e)
    }
  },
)

server.registerTool(
  'browser_eval',
  {
    title: 'Run JavaScript in the embedded browser',
    description: 'Evaluate JavaScript in the embedded-browser page context and return its JSON-serializable result.',
    inputSchema: { code: z.string().describe('JavaScript to evaluate in the page.') },
  },
  async ({ code }) => {
    if (!BRIDGE) return noBridge()
    try {
      return textResult(await browserCall('eval', { body: { code } }))
    } catch (e) {
      return errResult(e)
    }
  },
)

for (const action of ['back', 'forward', 'reload']) {
  server.registerTool(
    `browser_${action}`,
    {
      title: `Browser ${action}`,
      description: `${action[0].toUpperCase() + action.slice(1)} the embedded browser.`,
      inputSchema: {},
    },
    async () => {
      if (!BRIDGE) return noBridge()
      try {
        await browserCall(action)
        return textResult(await browserCall('read'))
      } catch (e) {
        return errResult(e)
      }
    },
  )
}

await server.connect(new StdioServerTransport())
