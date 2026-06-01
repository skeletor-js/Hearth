// Filesystem access for the Files tab + in-app editor. Every operation is rooted
// at a workspace cwd and path-guarded: a relative path is resolved against the
// root and rejected if it escapes (no `..` traversal out of the workspace).
//
// Writing a Hearth source file lands on disk and the dev server HMRs it live, but
// it is NOT committed — History is the agent's self-mods, not the user's manual
// editor edits (see UI-PLAN P4-1).

import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, mkdir, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path'

export interface FileEntry {
  name: string
  rel: string
  dir: boolean
}

// `.hearth/` is Hearth's own runtime state (gitignored). The scratchpad lives there;
// keep the whole dir out of the user-facing file tree.
const IGNORED = new Set(['.git', 'node_modules', 'out', 'dist', '.DS_Store', '.hearth'])

/** Resolve `rel` under `root`, throwing if it escapes the root. */
function safeJoin(root: string, rel: string): string {
  const abs = resolve(root, rel)
  const rl = relative(root, abs)
  if (rl.startsWith('..') || isAbsolute(rl)) throw new Error('path escapes workspace')
  return abs
}

/** Immediate children of `rel` within the workspace, dirs first then files. */
export async function listDir(root: string, rel = ''): Promise<FileEntry[]> {
  const abs = rel ? safeJoin(root, rel) : root
  const dirents = await readdir(abs, { withFileTypes: true })
  const entries: FileEntry[] = []
  for (const d of dirents) {
    if (IGNORED.has(d.name)) continue
    entries.push({ name: d.name, rel: (rel ? rel + sep : '') + d.name, dir: d.isDirectory() })
  }
  return entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

const MAX_READ = 2 * 1024 * 1024 // 2 MB — the editor isn't for giant/binary blobs

export interface FileContent {
  rel: string
  content: string
  /** True if the file looks binary or is too large to edit. */
  readonly: boolean
}

export async function readFile(root: string, rel: string): Promise<FileContent> {
  const abs = safeJoin(root, rel)
  const s = await stat(abs)
  if (s.size > MAX_READ) return { rel, content: `// ${rel} is ${Math.round(s.size / 1024)} KB — too large to edit here.`, readonly: true }
  const buf = await fsReadFile(abs)
  if (buf.includes(0)) return { rel, content: `// ${rel} is a binary file.`, readonly: true }
  return { rel, content: buf.toString('utf8'), readonly: false }
}

export async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = safeJoin(root, rel)
  await mkdir(dirname(abs), { recursive: true }) // create parent dirs (e.g. a missing .hearth/)
  await fsWriteFile(abs, content, 'utf8')
}
