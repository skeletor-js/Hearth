// Session persistence: an append-only JSONL transcript per session + a JSON
// index of metadata. Matches the ecosystem (Claude Code/Codex/Zed all persist
// transcripts) and survives restarts — powering Recents, Search, and resume.
//
// The transcript stores the raw turn stream (user prompts + SessionUpdates) so
// the renderer can replay it through the same reducer that renders a live turn,
// restoring a session at full fidelity. This module is storage only — no agent,
// no Electron — so it unit-tests against a temp dir.

import { mkdir, readFile, writeFile, appendFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionUpdate } from '../../shared/protocol.js'

export type TranscriptEntry = { kind: 'user'; text: string } | { kind: 'update'; update: SessionUpdate }

export interface SessionMeta {
  id: string
  title: string
  workspaceId: string
  cwd: string
  /** True when this session targets the Hearth repo itself. */
  self: boolean
  createdAt: number
  updatedAt: number
  archived: boolean
}

export interface SessionDetail {
  meta: SessionMeta
  entries: TranscriptEntry[]
}

export interface CreateSessionInput {
  title?: string
  workspaceId: string
  cwd: string
  self: boolean
}

export class SessionStore {
  private counter = 0
  constructor(
    private readonly baseDir: string,
    /** Injectable clock so tests are deterministic; defaults to Date.now. */
    private readonly now: () => number = Date.now,
  ) {}

  private indexPath(): string {
    return join(this.baseDir, 'index.json')
  }
  private transcriptPath(id: string): string {
    return join(this.baseDir, 'transcripts', `${id}.jsonl`)
  }

  private async readIndex(): Promise<SessionMeta[]> {
    try {
      const raw = await readFile(this.indexPath(), 'utf8')
      const parsed = JSON.parse(raw) as SessionMeta[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async writeIndex(index: SessionMeta[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2))
  }

  private async patch(id: string, fn: (m: SessionMeta) => SessionMeta): Promise<SessionMeta | null> {
    const index = await this.readIndex()
    const i = index.findIndex((m) => m.id === id)
    if (i < 0) return null
    index[i] = fn(index[i])
    await this.writeIndex(index)
    return index[i]
  }

  /** Non-archived sessions, newest activity first. */
  async list(): Promise<SessionMeta[]> {
    return (await this.readIndex()).filter((m) => !m.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async create(input: CreateSessionInput): Promise<SessionMeta> {
    const t = this.now()
    const meta: SessionMeta = {
      id: `s_${t.toString(36)}_${this.counter++}`,
      title: input.title?.trim() || 'New session',
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      self: input.self,
      createdAt: t,
      updatedAt: t,
      archived: false,
    }
    await this.writeIndex([meta, ...(await this.readIndex())])
    await mkdir(join(this.baseDir, 'transcripts'), { recursive: true })
    await writeFile(this.transcriptPath(meta.id), '')
    return meta
  }

  async get(id: string): Promise<SessionDetail | null> {
    const meta = (await this.readIndex()).find((m) => m.id === id)
    if (!meta) return null
    let entries: TranscriptEntry[] = []
    try {
      const raw = await readFile(this.transcriptPath(id), 'utf8')
      entries = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as TranscriptEntry)
    } catch {
      entries = []
    }
    return { meta, entries }
  }

  /** Append transcript entries and bump updatedAt. Auto-titles from the first user line. */
  async append(id: string, entries: TranscriptEntry[]): Promise<void> {
    if (entries.length === 0) return
    await mkdir(join(this.baseDir, 'transcripts'), { recursive: true })
    await appendFile(this.transcriptPath(id), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    const firstUser = entries.find((e) => e.kind === 'user') as Extract<TranscriptEntry, { kind: 'user' }> | undefined
    await this.patch(id, (m) => ({
      ...m,
      updatedAt: this.now(),
      title: m.title === 'New session' && firstUser ? firstUser.text.slice(0, 60) : m.title,
    }))
  }

  async rename(id: string, title: string): Promise<SessionMeta | null> {
    return this.patch(id, (m) => ({ ...m, title: title.trim() || m.title, updatedAt: this.now() }))
  }

  async archive(id: string): Promise<void> {
    await this.patch(id, (m) => ({ ...m, archived: true }))
  }

  async remove(id: string): Promise<void> {
    await this.writeIndex((await this.readIndex()).filter((m) => m.id !== id))
    await rm(this.transcriptPath(id), { force: true })
  }

  async duplicate(id: string): Promise<SessionMeta | null> {
    const detail = await this.get(id)
    if (!detail) return null
    const copy = await this.create({
      title: `${detail.meta.title} (copy)`,
      workspaceId: detail.meta.workspaceId,
      cwd: detail.meta.cwd,
      self: detail.meta.self,
    })
    await this.append(copy.id, detail.entries)
    return copy
  }

  /** All non-archived transcript ids on disk (diagnostic / cleanup). */
  async transcriptIds(): Promise<string[]> {
    try {
      return (await readdir(join(this.baseDir, 'transcripts'))).map((f) => f.replace(/\.jsonl$/, ''))
    } catch {
      return []
    }
  }
}
