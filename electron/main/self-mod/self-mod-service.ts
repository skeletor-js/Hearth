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

  /** Call after an agent turn that touched the repo. No-op if nothing changed. */
  async captureTurn(conversationId: string, subject: string): Promise<SelfModResult | null> {
    const changedPaths = await listDirty(this.repoRoot)
    if (changedPaths.length === 0) return null

    const commit = await commitSelfMod(this.repoRoot, { subject, conversationId })
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
