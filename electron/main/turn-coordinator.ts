// The self-mod turn lifecycle (U13) — extracted verbatim from the agentPrompt
// god handler so ipc.ts is the thin transport ARCHITECTURE.md describes and
// the most intricate main-process sequence is unit-testable without Electron.
//
// Placement note: the audit plan suggested self-mod/, but that directory is
// the protected island (agent-unwritable). The lifecycle has always lived in
// canvas code (ipc.ts), so a canvas sibling preserves the existing protection
// posture; only injected dependencies cross into the island.
//
// The ordering invariants below are pinned by ipc.turn-lifecycle.test.ts (U3)
// and turn-coordinator.test.ts — recover → dirty baseline → beginTurn/mint →
// overlay turn-start → prompt → endRun effects in a finally → captureTurn →
// overlay turn-end. captureTurn MUST stay in the finally: a mid-turn adapter
// death still commits the partial edit instead of orphaning it.

import { HEARTH_CHANNELS } from '../shared/channels.js'
import type { PromptImage } from '../shared/protocol.js'
import type { AgentHost } from './agents/agent-host.js'
import type { SessionStore } from './sessions/store.js'
import type { SelfModService, SelfModResult } from './self-mod/self-mod-service.js'
import type { RunTracker } from './self-mod/run-tracker.js'
import type { OverlayClient } from './self-mod/overlay-client.js'
import type { TypecheckResult } from './self-mod/validate.js'
import { isViteTrackablePath } from './self-mod/path-relevance.js'

export interface TurnPayload {
  sessionId: string
  cwd?: string
  text: string
  images?: PromptImage[]
}

export interface TurnCoordinatorDeps {
  repoRoot: string
  host: Pick<AgentHost, 'prompt'>
  selfMod: Pick<SelfModService, 'recoverIfIncomplete' | 'dirtyPaths' | 'beginTurn' | 'captureTurn'>
  sessions: Pick<SessionStore, 'getMeta' | 'setAcpSessionId'>
  runTracker: RunTracker
  overlay: OverlayClient
  /** main → renderer broadcast (webContents.send in production). */
  send: (channel: string, payload: unknown) => void
  /** The async validation gate (W5) — `runTypecheck` in production. */
  typecheck: (repoRoot: string) => Promise<TypecheckResult>
}

export class TurnCoordinator {
  // Serialize turns per working directory. Self-mod's dirty-baseline diffing
  // (dirtyPaths before/after + the in-progress marker) assumes one turn at a
  // time per repo, so two turns on the SAME cwd must not overlap; turns in
  // DIFFERENT repos run concurrently (separate lock chains).
  private readonly turnLocks = new Map<string, Promise<unknown>>()
  private runSeq = 0

  constructor(private readonly deps: TurnCoordinatorDeps) {}

  async runTurn(payload: TurnPayload): Promise<SelfModResult | null> {
    const { repoRoot, host, selfMod, sessions, runTracker, overlay, send, typecheck } = this.deps
    const key = payload.sessionId || 'default'
    const cwd = payload.cwd || repoRoot
    const priorTurn = this.turnLocks.get(cwd) ?? Promise.resolve()
    let releaseTurn!: () => void
    const turnGate = new Promise<void>((r) => (releaseTurn = r))
    this.turnLocks.set(cwd, priorTurn.then(() => turnGate))
    await priorTurn.catch(() => {})
    try {
      // Recover an interrupted prior turn (crashed before captureTurn) before we
      // baseline — commits its orphaned changes as a `recovered` run, never lost.
      await selfMod.recoverIfIncomplete(key)
      // Snapshot what's already dirty BEFORE the turn so captureTurn commits only
      // what this turn changes — never the developer's pre-existing uncommitted work.
      const before = await selfMod.dirtyPaths()
      // Mint a run + write the in-progress marker, then prompt.
      const runId = `run-${++this.runSeq}-${Date.now()}`
      runTracker.beginRun(runId, key)
      selfMod.beginTurn()
      // Suppress Vite's autonomous full-reload for full-reload-tier files during the
      // turn (B6); the change is applied at turn end under the morph cover (B5).
      void overlay.turnStart()
      // Resume real agent context for a reopened session: pass its stored ACP id
      // (if any) so the host can loadSession instead of starting cold (W3).
      const meta = await sessions.getMeta(key)
      let result
      try {
        const acpId = await host.prompt(payload.text, {
          key,
          cwd: payload.cwd || repoRoot,
          images: payload.images,
          resumeId: meta?.acpSessionId,
        })
        // Persist the ACP session id on first turn so later reopens can resume it.
        if (acpId && acpId !== meta?.acpSessionId) await sessions.setAcpSessionId(key, acpId)
      } catch (err) {
        // Adapters can reject with a JSON-RPC error object (not an Error), which
        // serializes across IPC as "[object Object]". Normalize to a real Error
        // with a readable message so the renderer shows the actual failure.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err
              ? (err as { message?: unknown }).message
                ? String((err as { message: unknown }).message)
                : JSON.stringify(err)
              : String(err)
        throw new Error(message)
      } finally {
        const ended = runTracker.endRun(runId)
        // Apply the overlay batch (no-op for unpinned paths / single-writer turns).
        void overlay.apply((ended?.groups ?? []).flatMap((g) => g.paths).filter(isViteTrackablePath))
        send(HEARTH_CHANNELS.selfModActivity, { runId, sessionId: key, lanes: [], collisions: [] })
        // captureTurn → HmrController.apply fires the morph for full-reload-tier
        // edits. turnEnd lifts suppression after (the morph's own reload is explicit,
        // not a Vite file-watch reload, so it isn't affected by the flag).
        result = await selfMod.captureTurn(key, payload.text.slice(0, 72), before, ended ? { runId, groups: ended.groups } : undefined)
        void overlay.turnEnd()
      }
      // W7: surface any writes the scope guard rejected (protected island / secrets)
      // so the user knows the agent's edit there was undone, not silently dropped.
      if (result?.rejectedPaths?.length) {
        send(HEARTH_CHANNELS.selfModValidation, {
          ok: false,
          output: `Blocked edits to protected/secret paths (restored, not committed):\n${result.rejectedPaths.join('\n')}`,
        })
      }
      // A restart-tier edit that failed the blocking typecheck (W6): surface it so
      // the crash surface offers Undo/Repair instead of bricking on restart.
      if (result?.blockedRestart) {
        send(HEARTH_CHANNELS.selfModValidation, { ok: false, output: result.blockedRestart.output })
      } else if (result && result.changedPaths.some((p) => isViteTrackablePath(p))) {
        // Async validation gate (W5): typecheck renderer edits without blocking the
        // turn; surface a failure for the crash surface / repair.
        void typecheck(repoRoot).then((tc) => {
          if (!tc.ok) send(HEARTH_CHANNELS.selfModValidation, tc)
        })
      }
      return result
    } finally {
      releaseTurn()
    }
  }
}
