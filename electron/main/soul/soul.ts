// Soul + Memory delivery. Personality settings compile to a "Soul" instruction
// block; durable notes form a "Memory" block. Both are written as idempotent
// HEARTH-managed regions into each backend's NATIVE global instructions file
// (Claude's CLAUDE.md, Codex's AGENTS.md) so the agent actually reads them. We
// write ONLY the delimited block — the user's own content is preserved. See
// docs/SOUL-AND-MEMORY.md.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readBlock, upsertBlock } from './managed-block.js'

export interface SoulConfig {
  length: 'short' | 'balanced' | 'thorough'
  directness: 'gentle' | 'direct'
  density: 'compact' | 'roomy'
}

export const DEFAULT_SOUL: SoulConfig = { length: 'balanced', directness: 'direct', density: 'compact' }

const LENGTH_LINE: Record<SoulConfig['length'], string> = {
  short: 'Keep replies short and to the point; lead with the answer.',
  balanced: 'Aim for balanced replies — enough to be useful, no filler.',
  thorough: 'Be thorough; cover edge cases and reasoning when it helps.',
}
const DIRECTNESS_LINE: Record<SoulConfig['directness'], string> = {
  gentle: 'Use a warm, encouraging tone.',
  direct: 'Be direct and plainspoken; say when something is wrong and why.',
}
const DENSITY_LINE: Record<SoulConfig['density'], string> = {
  compact: 'Prefer compact formatting; use lists sparingly.',
  roomy: 'Use generous structure — headings and lists — when it aids scanning.',
}

/** Compile personality settings into a short Soul instruction block. */
export function compileSoul(c: SoulConfig): string {
  return ['## Soul', '', LENGTH_LINE[c.length], DIRECTNESS_LINE[c.directness], DENSITY_LINE[c.density]].join('\n')
}

// Hearth's always-on operating instructions (global, so they apply in folder
// workspaces too — not just the repo cwd).
const OPERATING = [
  '## Hearth operating instructions',
  '',
  'You are running inside Hearth, a self-evolving desktop client. You can see and',
  'drive the live app and an embedded browser via the `hearth` MCP tools',
  '(view_app/read_ui/click/fill/eval_js, browser_*). When asked to change Hearth',
  'itself, edit its repo (REPO_ROOT) — those edits hot-reload and are versioned.',
  'A session may run in any workspace folder; edit files relative to the task cwd.',
  '',
  'The user may keep a scratchpad at `.hearth/scratchpad.md` in the workspace — read',
  'it for context when helpful, but treat it as read-only: never write to it.',
].join('\n')

export type Backend = 'claude' | 'codex'

/** The native global-instructions file Hearth writes its managed block into. */
export function globalInstructionsPath(backend: Backend): string {
  return backend === 'codex' ? join(homedir(), '.codex', 'AGENTS.md') : join(homedir(), '.claude', 'CLAUDE.md')
}

async function readMaybe(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Writes Hearth's managed block (operating instructions + Soul + Memory) into a
 * backend's global instructions file, preserving the user's own content. Memory
 * is left as-is when not provided (the agent edits it via file tools on
 * "remember/forget"); pass it to seed/replace.
 */
export class SoulService {
  constructor(private readonly backends: Backend[] = ['claude', 'codex']) {}

  private async writeManaged(backend: Backend, soul: string, memory: string | null): Promise<void> {
    const path = globalInstructionsPath(backend)
    let content = await readMaybe(path)
    // Operating + Soul live in one block; Memory is its own block so the agent can
    // append to it independently.
    content = upsertBlock(content, 'managed', `${OPERATING}\n\n${soul}`)
    if (memory !== null) content = upsertBlock(content, 'memory', `## Memory\n\n${memory.trim() || '_(empty)_'}`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }

  /** Regenerate Soul (and operating instructions) for all backends. */
  async setPersonality(config: SoulConfig): Promise<void> {
    const soul = compileSoul(config)
    for (const b of this.backends) await this.writeManaged(b, soul, null)
  }

  /** The current global Memory block for a backend (for Settings → Memory display). */
  async getMemory(backend: Backend = 'claude'): Promise<string> {
    const content = await readMaybe(globalInstructionsPath(backend))
    const block = readBlock(content, 'memory')
    return block ? block.replace(/^## Memory\n*/, '').trim() : ''
  }
}
