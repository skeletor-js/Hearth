// Runtime validation for the structured IPC inputs that reach disk (U22).
// The renderer is treated as a potentially compromised peer (the threat model
// behind the bridge token and the scope guard), so the few inputs main
// persists as-shaped — MCP servers, routines, the soul config — get narrow
// hand-rolled guards here. Deliberately no validation framework: this matches
// the codebase's dependency restraint, and three shapes don't need one.
import type { CreateRoutineInput } from '../shared/protocol.js'
import type { McpServerInput } from './mcp/registry.js'
import type { SoulConfig } from './soul/soul.js'

/** Typed rejection the renderer can distinguish from an internal failure. */
export class InvalidInputError extends Error {
  readonly code = 'invalid-input'
  constructor(what: string, why: string) {
    super(`invalid ${what}: ${why}`)
    this.name = 'InvalidInputError'
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

// --- MCP servers --------------------------------------------------------------

function envVarWhy(v: unknown): string | null {
  if (!isRecord(v)) return 'env entry is not an object'
  if (!isStr(v.name)) return 'env entry needs a string name'
  if (v.secretKey !== undefined && !isStr(v.secretKey)) return 'env secretKey must be a string'
  if (v.value !== undefined && !isStr(v.value)) return 'env value must be a string'
  return null
}

function transportWhy(v: unknown): string | null {
  if (!isRecord(v)) return 'transport is not an object'
  if (v.type === 'stdio') {
    if (!isStr(v.command)) return 'stdio transport needs a string command'
    if (!Array.isArray(v.args) || !v.args.every(isStr)) return 'stdio transport needs string[] args'
    return null
  }
  if (v.type === 'http' || v.type === 'sse') {
    return isStr(v.url) ? null : `${v.type} transport needs a string url`
  }
  return 'transport type must be stdio | http | sse'
}

export function assertMcpServerInput(v: unknown): asserts v is McpServerInput {
  if (!isRecord(v)) throw new InvalidInputError('MCP server', 'not an object')
  if (!isStr(v.name) || !v.name.trim()) throw new InvalidInputError('MCP server', 'needs a non-empty string name')
  if (typeof v.enabled !== 'boolean') throw new InvalidInputError('MCP server', 'enabled must be a boolean')
  const t = transportWhy(v.transport)
  if (t) throw new InvalidInputError('MCP server', t)
  if (!Array.isArray(v.env)) throw new InvalidInputError('MCP server', 'env must be an array')
  for (const e of v.env) {
    const why = envVarWhy(e)
    if (why) throw new InvalidInputError('MCP server', why)
  }
}

/** Updates arrive as partials — validate exactly the fields present. */
export function assertMcpServerPatch(v: unknown): asserts v is Partial<McpServerInput> {
  if (!isRecord(v)) throw new InvalidInputError('MCP server patch', 'not an object')
  if (v.name !== undefined && (!isStr(v.name) || !v.name.trim())) throw new InvalidInputError('MCP server patch', 'name must be a non-empty string')
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') throw new InvalidInputError('MCP server patch', 'enabled must be a boolean')
  if (v.transport !== undefined) {
    const t = transportWhy(v.transport)
    if (t) throw new InvalidInputError('MCP server patch', t)
  }
  if (v.env !== undefined) {
    if (!Array.isArray(v.env)) throw new InvalidInputError('MCP server patch', 'env must be an array')
    for (const e of v.env) {
      const why = envVarWhy(e)
      if (why) throw new InvalidInputError('MCP server patch', why)
    }
  }
}

// --- Routines -----------------------------------------------------------------

function scheduleWhy(v: unknown): string | null {
  if (!isRecord(v)) return 'schedule is not an object'
  if (v.type === 'daily') return isStr(v.time) && /^\d{2}:\d{2}$/.test(v.time) ? null : 'daily schedule needs time "HH:MM"'
  if (v.type === 'interval')
    return typeof v.everyMinutes === 'number' && Number.isFinite(v.everyMinutes) && v.everyMinutes > 0
      ? null
      : 'interval schedule needs a positive everyMinutes'
  return 'schedule type must be daily | interval'
}

export function assertCreateRoutineInput(v: unknown): asserts v is CreateRoutineInput {
  if (!isRecord(v)) throw new InvalidInputError('routine', 'not an object')
  if (!isStr(v.title) || !v.title.trim()) throw new InvalidInputError('routine', 'needs a non-empty string title')
  if (!isStr(v.prompt) || !v.prompt.trim()) throw new InvalidInputError('routine', 'needs a non-empty string prompt')
  if (!isStr(v.workspaceId)) throw new InvalidInputError('routine', 'needs a string workspaceId')
  if (!isStr(v.cwd)) throw new InvalidInputError('routine', 'needs a string cwd')
  const s = scheduleWhy(v.schedule)
  if (s) throw new InvalidInputError('routine', s)
}

export function assertRoutinePatch(v: unknown): asserts v is Partial<CreateRoutineInput> {
  if (!isRecord(v)) throw new InvalidInputError('routine patch', 'not an object')
  if (v.title !== undefined && (!isStr(v.title) || !v.title.trim())) throw new InvalidInputError('routine patch', 'title must be a non-empty string')
  if (v.prompt !== undefined && (!isStr(v.prompt) || !v.prompt.trim())) throw new InvalidInputError('routine patch', 'prompt must be a non-empty string')
  if (v.workspaceId !== undefined && !isStr(v.workspaceId)) throw new InvalidInputError('routine patch', 'workspaceId must be a string')
  if (v.cwd !== undefined && !isStr(v.cwd)) throw new InvalidInputError('routine patch', 'cwd must be a string')
  if (v.schedule !== undefined) {
    const s = scheduleWhy(v.schedule)
    if (s) throw new InvalidInputError('routine patch', s)
  }
}

// --- Soul ----------------------------------------------------------------------

const SOUL_VALUES: { [K in keyof SoulConfig]: readonly string[] } = {
  length: ['short', 'balanced', 'thorough'],
  directness: ['gentle', 'direct'],
  density: ['compact', 'roomy'],
}

export function assertSoulConfig(v: unknown): asserts v is SoulConfig {
  if (!isRecord(v)) throw new InvalidInputError('soul config', 'not an object')
  for (const [key, allowed] of Object.entries(SOUL_VALUES)) {
    const got = v[key]
    if (!isStr(got) || !allowed.includes(got)) {
      throw new InvalidInputError('soul config', `${key} must be one of ${allowed.join(' | ')}`)
    }
  }
}
