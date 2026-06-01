// Orchestrates the self-modification loop: after the agent writes files, commit
// them and apply the right reload. Exposes commit/revert to IPC.
//
// The agent does the actual file writes (it has the repo as its cwd via ACP).
// This service does NOT write source files itself — it observes what changed,
// versions it, and reloads. Keeping the write authority with the agent and the
// safety/versioning here is the separation that makes the loop debuggable.

import { commitSelfMod, diffPaths, listDirty, recentSelfMods, redoTarget, tryRevert, type SelfModKind, type SelfModLogEntry } from './git.js'
import { HmrController } from './hmr.js'
import type { ReloadKind } from './path-relevance.js'

export interface SelfModResult {
  commit: string
  changedPaths: string[]
  reload: ReloadKind
}

/** Result of an undo/redo step. A conflict is routed to the agent by the UI. */
export type StepResult =
  | { status: 'ok'; commit: string; changedPaths: string[]; reload: ReloadKind }
  | { status: 'dirty' }
  | { status: 'conflict'; hash: string; files: string[] }
  | { status: 'noop' }

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

  /**
   * Step the history (undo a self-mod, or redo by reverting its revert). Guards a
   * dirty tree, and on a revert conflict returns the conflicted files so the UI can
   * hand the resolution to Hearth's agent (Model A — see SELF-EVOLUTION-HISTORY.md).
   */
  async undo(hash: string): Promise<StepResult> {
    return this.step(hash, hash)
  }

  async redo(hash: string): Promise<StepResult> {
    const target = await redoTarget(this.repoRoot, hash)
    if (!target) return { status: 'noop' }
    return this.step(hash, target)
  }

  private async step(originalHash: string, revertHash: string): Promise<StepResult> {
    if ((await listDirty(this.repoRoot)).length > 0) return { status: 'dirty' }
    const outcome = await tryRevert(this.repoRoot, revertHash)
    if (!outcome.ok) return { status: 'conflict', hash: originalHash, files: outcome.files }
    const changedPaths = await diffPaths(this.repoRoot, outcome.commit)
    const reload = this.hmr.apply(changedPaths)
    return { status: 'ok', commit: outcome.commit, changedPaths, reload }
  }

  /**
   * Commit specific repo paths directly (not via an agent turn) with an explicit
   * surface category — used by Settings to version soul/memory edits. No HMR:
   * soul/memory are instruction data, not renderer source.
   */
  async commitManaged(paths: string[], subject: string, kind: SelfModKind): Promise<{ commit: string; changedPaths: string[] }> {
    const commit = await commitSelfMod(this.repoRoot, { paths, subject, conversationId: 'settings', kind })
    return { commit, changedPaths: paths }
  }

  history(): Promise<SelfModLogEntry[]> {
    return recentSelfMods(this.repoRoot)
  }
}
