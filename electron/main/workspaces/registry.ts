// Workspace registry: the built-in Hearth workspace plus any user-opened folders.
// A workspace only sets the task cwd for a session (see UI-PLAN founding
// principle). Persisted as a small JSON file in userData. The picker dialog and
// dugite status live in IPC; this module is pure list management so it can be
// unit-tested without Electron.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, basename } from 'node:path'

export interface Workspace {
  id: string
  name: string
  path: string
  /** The built-in Hearth repo workspace — always present, never removable. */
  isHearth: boolean
}

const HEARTH_ID = 'hearth'

/** Deterministic id from a path (avoids Math.random; stable across restarts). */
function idFor(path: string): string {
  let h = 0
  for (let i = 0; i < path.length; i++) h = (Math.imul(31, h) + path.charCodeAt(i)) | 0
  return 'ws_' + (h >>> 0).toString(36)
}

export class WorkspaceRegistry {
  constructor(
    private readonly filePath: string,
    private readonly repoRoot: string,
  ) {}

  private hearth(): Workspace {
    return { id: HEARTH_ID, name: 'Hearth', path: this.repoRoot, isHearth: true }
  }

  private async readUser(): Promise<Workspace[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Workspace[]
      return Array.isArray(parsed) ? parsed.filter((w) => !w.isHearth) : []
    } catch {
      return []
    }
  }

  private async writeUser(list: Workspace[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(list, null, 2))
  }

  /** Built-in Hearth workspace first, then user-opened folders. */
  async list(): Promise<Workspace[]> {
    return [this.hearth(), ...(await this.readUser())]
  }

  /** Register a folder (idempotent by path). Returns the existing or new entry. */
  async add(path: string): Promise<Workspace> {
    if (path === this.repoRoot) return this.hearth()
    const user = await this.readUser()
    const existing = user.find((w) => w.path === path)
    if (existing) return existing
    const ws: Workspace = { id: idFor(path), name: basename(path) || path, path, isHearth: false }
    await this.writeUser([...user, ws])
    return ws
  }

  async remove(id: string): Promise<void> {
    if (id === HEARTH_ID) return // the built-in workspace is permanent
    await this.writeUser((await this.readUser()).filter((w) => w.id !== id))
  }

  async get(id: string): Promise<Workspace | null> {
    return (await this.list()).find((w) => w.id === id) ?? null
  }
}
