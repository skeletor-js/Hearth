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
  /** The ACP adapter's session id for this conversation, captured on first prompt.
   * Lets a reopened session resume real agent context via ACP `loadSession`
   * instead of starting cold. Absent until the first turn. */
  acpSessionId?: string
  createdAt: number
  updatedAt: number
  archived: boolean
}

export interface SessionDetail {
  meta: SessionMeta
  entries: TranscriptEntry[]
}

export interface SessionSearchHit {
  meta: SessionMeta
  /** A text excerpt around the first content match; absent when the hit was only
   * in the title/workspace. The renderer highlights the query within it. */
  snippet?: string
}

/** The searchable text of a transcript entry — what the user typed, what Hearth
 * said, and its reasoning. Tool calls / diffs are structural, not prose. */
function entryText(e: TranscriptEntry): string {
  if (e.kind === 'user') return e.text
  if (e.update.type === 'message' || e.update.type === 'thought') return e.update.text
  return ''
}

/** A whitespace-collapsed window around a match, with ellipses when clipped. */
function excerpt(text: string, idx: number, len: number, radius = 64): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + len + radius)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '… ' : '') + body + (end < text.length ? ' …' : '')
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

  /** A session created but never used. `append`/`rename` both bump updatedAt past
   * createdAt (see `bumped`), so "never touched" ⟺ updatedAt === createdAt. These
   * are hidden from lists and swept on the next create, so unused "New session"
   * rows never pile up across the rail, Home, Search, and resume. */
  private untouched(m: SessionMeta): boolean {
    return m.updatedAt === m.createdAt
  }

  /** A bumped updatedAt that is always strictly greater than createdAt, even when
   * the wall clock hasn't advanced a millisecond since create — so `untouched`
   * can never mis-flag a session that actually has content. */
  private bumped(m: SessionMeta): number {
    return Math.max(this.now(), m.createdAt + 1)
  }

  /** Non-archived, used sessions — newest activity first. Untouched (created but
   * never prompted) sessions are excluded; they surface once they have content. */
  async list(): Promise<SessionMeta[]> {
    return (await this.readIndex())
      .filter((m) => !m.archived && !this.untouched(m))
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
    // Sweep previously-untouched sessions so abandoned empties never accumulate
    // (clicking New Session / a workspace without typing leaves one behind).
    const existing = await this.readIndex()
    const stale = existing.filter((m) => this.untouched(m))
    const keep = existing.filter((m) => !this.untouched(m))
    await this.writeIndex([meta, ...keep])
    await mkdir(join(this.baseDir, 'transcripts'), { recursive: true })
    await writeFile(this.transcriptPath(meta.id), '')
    for (const m of stale) await rm(this.transcriptPath(m.id), { force: true })
    return meta
  }

  /** Metadata only (no transcript read) — used to look up the ACP session id. */
  async getMeta(id: string): Promise<SessionMeta | null> {
    return (await this.readIndex()).find((m) => m.id === id) ?? null
  }

  /** Record the ACP adapter's session id so the session can later be resumed. */
  async setAcpSessionId(id: string, acpSessionId: string): Promise<SessionMeta | null> {
    return this.patch(id, (m) => ({ ...m, acpSessionId }))
  }

  private async readEntries(id: string): Promise<TranscriptEntry[]> {
    try {
      const raw = await readFile(this.transcriptPath(id), 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as TranscriptEntry)
    } catch {
      return []
    }
  }

  async get(id: string): Promise<SessionDetail | null> {
    const meta = (await this.readIndex()).find((m) => m.id === id)
    if (!meta) return null
    return { meta, entries: await this.readEntries(id) }
  }

  /** Search titles, workspace paths, and transcript content. Empty query returns
   * the full list (newest-first). Content matches carry a highlighted snippet. */
  async search(query: string): Promise<SessionSearchHit[]> {
    const metas = await this.list()
    const q = query.trim().toLowerCase()
    if (!q) return metas.map((meta) => ({ meta }))
    const hits: SessionSearchHit[] = []
    for (const meta of metas) {
      const text = (await this.readEntries(meta.id)).map(entryText).filter(Boolean).join('\n')
      const idx = text.toLowerCase().indexOf(q)
      if (idx >= 0) hits.push({ meta, snippet: excerpt(text, idx, q.length) })
      else if ((meta.title + ' ' + meta.cwd).toLowerCase().includes(q)) hits.push({ meta })
    }
    return hits
  }

  /** Append transcript entries and bump updatedAt. Auto-titles from the first user line. */
  async append(id: string, entries: TranscriptEntry[]): Promise<void> {
    if (entries.length === 0) return
    await mkdir(join(this.baseDir, 'transcripts'), { recursive: true })
    await appendFile(this.transcriptPath(id), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    const firstUser = entries.find((e) => e.kind === 'user') as Extract<TranscriptEntry, { kind: 'user' }> | undefined
    await this.patch(id, (m) => ({
      ...m,
      updatedAt: this.bumped(m),
      title: m.title === 'New session' && firstUser ? firstUser.text.slice(0, 60) : m.title,
    }))
  }

  async rename(id: string, title: string): Promise<SessionMeta | null> {
    return this.patch(id, (m) => ({ ...m, title: title.trim() || m.title, updatedAt: this.bumped(m) }))
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
