// Write-mediation broker (W0b). When Hearth advertises the ACP `fs` capability,
// the agent's Edit/Write tools route file writes THROUGH here instead of straight
// to disk. That gives one choke point to:
//   1. enforce the scope guard (block secrets/system; gate the protected island),
//   2. prevent lost updates between parallel subagents via a 3-way merge — if the
//      file on disk moved since this writer last saw it, merge instead of clobber,
//   3. record the pre-edit baseline + touched path for the run tracker / overlay.
//
// Shell-based writes bypass the fs capability, so this is layered with the
// git-HEAD overlay (which catches every write path). The core here is pure given
// injected fs + merge deps, so it unit-tests without a repo. The production
// factory wires real fs + `git merge-file`. See SELF-MOD-HARDENING-PLAN W0b.

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { classifyWrite } from './scope-guard.js'

export type WriteOutcome =
  | { status: 'ok' }
  | { status: 'merged' }
  | { status: 'conflict'; reason: string }
  | { status: 'blocked'; reason: string }
  | { status: 'protected'; reason: string }

export interface MergeResult {
  clean: boolean
  text: string
}

export interface BrokerDeps {
  repoRoot: string
  /** Read disk content, or null if the file doesn't exist. */
  read(absPath: string): string | null
  /** Write disk content (creating parents). */
  write(absPath: string, content: string): void
  /** 3-way merge: base ancestor, ours (current disk), theirs (incoming). */
  merge(base: string, ours: string, theirs: string): MergeResult
  /** Approve a write into the protected island. Default: deny. */
  approveProtected?(absPath: string): boolean
  /** Notified for every accepted write with the path's pre-edit baseline. */
  onWrite?(absPath: string, baseline: string | null): void
}

export class WriteBroker {
  // Per-path: the content the broker last *served on read* or *wrote*. Used as the
  // merge ancestor so a write that was based on stale content is merged, not lost.
  private base = new Map<string, string | null>()

  constructor(private readonly deps: BrokerDeps) {}

  /** Serve a read and remember the version this caller saw. */
  readFile(absPath: string): string | null {
    const content = this.deps.read(absPath)
    this.base.set(absPath, content)
    return content
  }

  /**
   * Mediate a write. Enforces scope, then either writes through, 3-way merges
   * (when disk moved under us), or rejects on a true conflict.
   */
  writeFile(absPath: string, incoming: string): WriteOutcome {
    const decision = classifyWrite(absPath, this.deps.repoRoot)
    if (decision.tier === 'blocked') {
      return { status: 'blocked', reason: decision.reason ?? 'blocked path' }
    }
    if (decision.tier === 'protected' && !(this.deps.approveProtected?.(absPath) ?? false)) {
      return { status: 'protected', reason: decision.reason ?? 'protected path needs approval' }
    }

    const current = this.deps.read(absPath)
    const baseline = this.base.has(absPath) ? this.base.get(absPath)! : current

    // Disk moved since we last saw it AND both sides exist → another writer got
    // here first. Merge our ancestor (baseline) with their result (current disk)
    // and our intended change (incoming).
    if (baseline !== current && baseline !== null && current !== null) {
      const m = this.deps.merge(baseline, current, incoming)
      if (!m.clean) {
        return { status: 'conflict', reason: 'overlapping edits to the same lines' }
      }
      this.deps.write(absPath, m.text)
      this.deps.onWrite?.(absPath, baseline)
      this.base.set(absPath, m.text)
      return { status: 'merged' }
    }

    this.deps.write(absPath, incoming)
    this.deps.onWrite?.(absPath, baseline ?? null)
    this.base.set(absPath, incoming)
    return { status: 'ok' }
  }
}

/**
 * Real 3-way merge via `git merge-file -p` (clean exit 0; conflicts → exit > 0).
 * Synchronous-style wrapper over a temp dir; used by the production broker.
 */
export function gitMergeFile(
  base: string,
  ours: string,
  theirs: string,
): Promise<MergeResult> {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-merge-'))
    const f = (n: string, c: string) => {
      const p = join(dir, n)
      writeFileSync(p, c)
      return p
    }
    const oursP = f('ours', ours)
    const baseP = f('base', base)
    const theirsP = f('theirs', theirs)
    execFile('git', ['merge-file', '-p', oursP, baseP, theirsP], (err, stdout) => {
      rmSync(dir, { recursive: true, force: true })
      // exit 0 → clean; exit >0 (err with positive code) → conflicts in stdout.
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 0
      resolve({ clean: code === 0, text: stdout })
    })
  })
}

/** Production broker wired to real fs + git merge-file (merge is async, so this
 * uses an async write path). Used by the ACP fs handlers. */
export interface AsyncWriteBroker {
  readFile(absPath: string): string | null
  writeFile(absPath: string, incoming: string): Promise<WriteOutcome>
}

export function createWriteBroker(opts: {
  repoRoot: string
  approveProtected?: (absPath: string) => boolean
  onWrite?: (absPath: string, baseline: string | null) => void
}): AsyncWriteBroker {
  const base = new Map<string, string | null>()
  const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null)
  const write = (p: string, c: string): void => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, c)
  }
  return {
    readFile(absPath) {
      const c = read(absPath)
      base.set(absPath, c)
      return c
    },
    async writeFile(absPath, incoming) {
      const decision = classifyWrite(absPath, opts.repoRoot)
      if (decision.tier === 'blocked') return { status: 'blocked', reason: decision.reason ?? 'blocked' }
      if (decision.tier === 'protected' && !(opts.approveProtected?.(absPath) ?? false)) {
        return { status: 'protected', reason: decision.reason ?? 'protected' }
      }
      const current = read(absPath)
      const baseline = base.has(absPath) ? base.get(absPath)! : current
      if (baseline !== current && baseline !== null && current !== null) {
        const m = await gitMergeFile(baseline, current, incoming)
        if (!m.clean) return { status: 'conflict', reason: 'overlapping edits' }
        write(absPath, m.text)
        opts.onWrite?.(absPath, baseline)
        base.set(absPath, m.text)
        return { status: 'merged' }
      }
      write(absPath, incoming)
      opts.onWrite?.(absPath, baseline ?? null)
      base.set(absPath, incoming)
      return { status: 'ok' }
    },
  }
}
