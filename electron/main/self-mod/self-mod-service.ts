// Orchestrates the self-modification loop: after the agent writes files, commit
// them and apply the right reload. Exposes commit/revert to IPC.
//
// The agent does the actual file writes (it has the repo as its cwd via ACP).
// This service does NOT write source files itself — it observes what changed,
// versions it, and reloads. Keeping the write authority with the agent and the
// safety/versioning here is the separation that makes the loop debuggable.

import { commitSelfMod, diffPaths, listDirty, recentSelfMods, revertCommit, type SelfModLogEntry } from './git.js'
import { HmrController } from './hmr.js'
import type { ReloadKind } from './path-relevance.js'

export interface SelfModResult {
  commit: string
  changedPaths: string[]
  reload: ReloadKind
}

export class SelfModService {
  constructor(
    private readonly repoRoot: string,
    private readonly hmr: HmrController,
  ) {}

  /** The repo's currently-dirty paths — snapshot this BEFORE a turn. */
  dirtyPaths(): Promise<string[]> {
    return listDirty(this.repoRoot)
  }

  /**
   * Call after an agent turn. Commits ONLY paths that became dirty *during* the
   * turn — `before` is the dirty set captured before the prompt. This is the
   * critical safety boundary: files the developer was already editing (or any
   * unrelated dirty state) must NOT be swept into a self-mod commit. No-op if the
   * turn changed nothing. Returns null when there's nothing new to commit.
   */
  async captureTurn(
    conversationId: string,
    subject: string,
    before: string[] = [],
  ): Promise<SelfModResult | null> {
    const beforeSet = new Set(before)
    const after = await listDirty(this.repoRoot)
    const changedPaths = after.filter((p) => !beforeSet.has(p))
    if (changedPaths.length === 0) return null

    const commit = await commitSelfMod(this.repoRoot, { paths: changedPaths, subject, conversationId })
    const reload = this.hmr.apply(changedPaths)
    return { commit, changedPaths, reload }
  }

  async undo(hash: string): Promise<SelfModResult> {
    const commit = await revertCommit(this.repoRoot, hash)
    // `git revert` already commits, so the tree is clean — listDirty would see
    // nothing. Read the files the revert commit itself touched to pick the right
    // reload tier (a reverted route edit still needs a full reload, etc.).
    const changedPaths = await diffPaths(this.repoRoot, commit)
    const reload = this.hmr.apply(changedPaths)
    return { commit, changedPaths, reload }
  }

  history(): Promise<SelfModLogEntry[]> {
    return recentSelfMods(this.repoRoot)
  }
}
