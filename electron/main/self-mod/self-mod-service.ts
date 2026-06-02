// Orchestrates the self-modification loop: after the agent writes files, commit
// them and apply the right reload. Exposes commit/revert to IPC.
//
// The agent does the actual file writes (it has the repo as its cwd via ACP).
// This service does NOT write source files itself — it observes what changed,
// versions it, and reloads. Keeping the write authority with the agent and the
// safety/versioning here is the separation that makes the loop debuggable.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { commitSelfMod, diffPaths, listDirty, listTrackedDirty, recentSelfMods, redoTarget, restorePaths, tryRevert, type SelfModKind, type SelfModLogEntry } from './git.js'
import { HmrController } from './hmr.js'
import { classifyBatch, type ReloadKind } from './path-relevance.js'
import { MAIN_LABEL, type CommitGroup } from './run-tracker.js'
import { classifyWrite } from './scope-guard.js'

/** Blocking validator for restart-tier edits (W6). Injected so it stays testable. */
export type Validator = (paths: string[]) => Promise<{ ok: boolean; output: string }>

export interface SelfModResult {
  /** Primary (first) commit hash of the turn — kept for back-compat. */
  commit: string
  /** All commit hashes produced this turn (one per file-disjoint subagent group). */
  commits: string[]
  changedPaths: string[]
  reload: ReloadKind
  /** Set when a restart-tier edit failed the blocking typecheck — restart skipped,
   * commit left in place (revertable). The caller surfaces the failure (W6). */
  blockedRestart?: { output: string }
  /** Paths the scope guard rejected (secrets / protected island): their edits were
   * restored on disk and NOT committed (W7 commit-time enforcement). */
  rejectedPaths?: string[]
}

/** Optional per-turn run info from the RunTracker (W0/W2). */
export interface TurnRun {
  runId: string
  groups: CommitGroup[]
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
    /** Blocking typecheck for restart-tier edits (W6). Omitted in tests. */
    private readonly validate?: Validator,
    /** Arm the boot watchdog with the commit about to trigger a restart (W6). */
    private readonly armRestart?: (commit: string) => void,
  ) {}

  /** Marker file proving a turn started but hasn't been committed yet. */
  private get markerPath(): string {
    return join(this.repoRoot, '.hearth', '.turn-in-progress')
  }

  /** The repo's currently-dirty paths — snapshot this BEFORE a turn. */
  dirtyPaths(): Promise<string[]> {
    return listDirty(this.repoRoot)
  }

  /** Write the in-progress marker. Call right before `host.prompt`. */
  beginTurn(): void {
    mkdirSync(dirname(this.markerPath), { recursive: true })
    writeFileSync(this.markerPath, new Date(0).toISOString())
  }

  /**
   * Incomplete-run recovery (W0). If a prior turn died before `captureTurn`, the
   * marker is still present AND the tree is dirty. Commit those orphaned changes
   * as a `recovered` run so they land in History/undoable — never silently
   * discarded — then proceed from a clean baseline. A dirty tree with NO marker is
   * the developer's WIP and is left untouched (excluded via `before` as before).
   */
  async recoverIfIncomplete(conversationId: string): Promise<SelfModResult | null> {
    if (!existsSync(this.markerPath)) return null
    const dirty = await listDirty(this.repoRoot)
    if (dirty.length === 0) {
      rmSync(this.markerPath, { force: true })
      return null
    }
    const commit = await commitSelfMod(this.repoRoot, {
      paths: dirty,
      subject: 'recovered: changes from an interrupted turn',
      conversationId,
      recovered: true,
    })
    rmSync(this.markerPath, { force: true })
    const reload = this.hmr.apply(dirty)
    return { commit, commits: [commit], changedPaths: dirty, reload }
  }

  /**
   * Call after an agent turn. Commits ONLY paths that became dirty *during* the
   * turn — `before` is the dirty set captured before the prompt. This is the
   * critical safety boundary: files the developer was already editing (or any
   * unrelated dirty state) must NOT be swept into a self-mod commit.
   *
   * When `run` is supplied (W2), the turn is split into **one commit per
   * file-disjoint subagent group**, so a parallel-subagent turn produces
   * independently-revertable commits grouped by `Hearth-Run`. Any dirty path the
   * stream missed is reconciled into a `main` group. No `run` (or a single group)
   * → today's one-commit behavior. No-op if the turn changed nothing.
   */
  async captureTurn(
    conversationId: string,
    subject: string,
    before: string[] = [],
    run?: TurnRun,
  ): Promise<SelfModResult | null> {
    const beforeSet = new Set(before)
    const after = await listDirty(this.repoRoot)
    const allChanged = after.filter((p) => !beforeSet.has(p))
    rmSync(this.markerPath, { force: true })
    if (allChanged.length === 0) return null

    // W7 commit-time scope enforcement. The mediation broker (W0b) is inert with
    // the current adapter (it writes disk directly — see acp-client), so the
    // commit layer is the universal choke point: reject writes to the protected
    // island or the hard-blocked denylist by restoring them on disk and never
    // committing them. Canvas paths proceed. (Protected paths could later carry an
    // explicit approval; for now they're treated as off-limits — the island stays
    // inviolable regardless of adapter or permission mode.)
    const rejectedPaths = allChanged.filter((p) => classifyWrite(p, this.repoRoot).tier !== 'canvas')
    if (rejectedPaths.length > 0) await restorePaths(this.repoRoot, rejectedPaths)
    const changedPaths = allChanged.filter((p) => !rejectedPaths.includes(p))
    if (changedPaths.length === 0) {
      return rejectedPaths.length > 0
        ? { commit: '', commits: [], changedPaths: [], reload: 'hmr', rejectedPaths }
        : null
    }

    const groups = this.resolveGroups(changedPaths, run?.groups)
    const commits: string[] = []
    const multi = groups.length > 1
    for (const g of groups) {
      const subj = multi && g.subagentLabel !== MAIN_LABEL ? `${g.subagentLabel}: ${subject}` : subject
      commits.push(
        await commitSelfMod(this.repoRoot, {
          paths: g.paths,
          subject: subj,
          conversationId,
          runId: run?.runId,
          subagent: g.subagentLabel !== MAIN_LABEL ? g.subagentLabel : undefined,
        }),
      )
    }
    // W6 blocking gate: a restart-tier edit (main/preload/config) can brick boot,
    // and the renderer crash surface can't recover main. Typecheck BEFORE restart;
    // on failure, keep the current process alive and surface it (commit stays,
    // revertable). Renderer/full-reload tiers are validated async by the caller.
    const tier = classifyBatch(changedPaths)
    if (tier === 'process-restart' && this.validate) {
      const tc = await this.validate(changedPaths)
      if (!tc.ok) {
        return { commit: commits[0], commits, changedPaths, reload: tier, blockedRestart: { output: tc.output }, ...(rejectedPaths.length ? { rejectedPaths } : {}) }
      }
      // Typecheck passed — arm the boot watchdog so a runtime boot-crash still
      // auto-reverts and relaunches.
      this.armRestart?.(commits[0])
    }
    const reload = this.hmr.apply(changedPaths)
    return { commit: commits[0], commits, changedPaths, reload, ...(rejectedPaths.length ? { rejectedPaths } : {}) }
  }

  /**
   * Map the run's tracked groups onto the *actually-dirty* paths, and sweep any
   * dirty path the stream missed into a `main` group (reconciliation union). Each
   * returned group is file-disjoint by construction (from the RunTracker).
   */
  private resolveGroups(changedPaths: string[], groups?: CommitGroup[]): CommitGroup[] {
    const dirty = new Set(changedPaths)
    const claimed = new Set<string>()
    const result: CommitGroup[] = []
    for (const g of groups ?? []) {
      const paths = g.paths.filter((p) => dirty.has(p))
      if (paths.length === 0) continue
      paths.forEach((p) => claimed.add(p))
      result.push({ ...g, paths })
    }
    const leftover = changedPaths.filter((p) => !claimed.has(p))
    if (leftover.length > 0) {
      result.push({ paths: leftover, subagentLabel: MAIN_LABEL, labels: [MAIN_LABEL] })
    }
    return result.length > 0 ? result : [{ paths: changedPaths, subagentLabel: MAIN_LABEL, labels: [MAIN_LABEL] }]
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
    // Only TRACKED changes block a revert — untracked files are never touched by
    // `git revert`, so an unrelated untracked file must not jam undo/redo.
    if ((await listTrackedDirty(this.repoRoot)).length > 0) return { status: 'dirty' }
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
