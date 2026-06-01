# History — self-evolution undo / redo / timeline (design)

This is the **History** surface: how Hearth steps backward and forward through the
*code/UI/skill* changes it makes to itself. Self-mod commits tagged
`Hearth-Kind: soul` or `memory` are categorized out to the separate **Personality**
and **Memory** surfaces (see [SOUL-AND-MEMORY.md](SOUL-AND-MEMORY.md)); History filters
to `Hearth-Kind: code`. The undo/redo model below applies to all three the same way.

How Hearth steps backward and forward through the changes it makes to *itself*.
This needs to be right: it's the safety net that makes letting an AI rewrite the
running app survivable. **Status: SIGNED OFF — build per this doc (UI-PLAN P6-1).**

## What we're modeling

- Every self-edit is already a git commit in Hearth's repo (`Hearth-SelfMod`
  trailer + conversation id), made by `captureTurn` after any turn that changed
  `REPO_ROOT`. Self-edits are made by the agent, not hand-edited, and committed
  immediately — so **between self-edits the working tree is normally clean.**
- The running dev app *is* this repo's renderer, so reverting a self-edit
  HMR-reloads the live UI back to the earlier state. History changes are visible
  immediately.
- We want the mock's experience: a timeline of self-edits, a "current build"
  marker, and undo/redo that the live app follows.

## The hard parts (why this isn't just `git reset`)

1. **Divergence.** Undo edit C (so HEAD is at B), then make a *new* self-edit D →
   the branch is now A→B→D and C is abandoned. "Redo C" is no longer well-defined.
   This is git's "can't redo after new work" problem.
2. **Conflicts.** Undoing a *non-latest* edit (undo B while C also touched B's
   lines) is a real merge conflict — the change can't be cleanly inverted.
3. **Dirty tree.** If there are uncommitted changes (a half-finished turn, a dev's
   WIP) when you step, a hard checkout/reset would clobber or be blocked.
4. **HMR coordination.** Each step changes source → must reload at the right tier
   (renderer HMR vs full reload vs process restart), and must not fight
   electron-vite's dev lifecycle (we already fixed `restartApp` for dev).

## Two models

### Model A — Append-only via revert  *(recommended)*
Self-edit commits are never moved or deleted. Stepping is itself a commit:

- **Undo X** = `git revert X` (a new commit that inverts X). HMR reloads to the
  reverted state. (We already do this, and already detect "reverted" state for the
  History UI.)
- **Redo X** = revert the revert → X is re-applied.
- **History UI** shows the *logical* timeline of self-edits; each edit's
  applied/undone state is derived from whether its inversions net out to "in
  effect." The raw revert-of-revert commits are hidden behind that logical view.
- **Divergence: solved by construction.** History is strictly linear and
  append-only; making a new edit after an undo just appends — nothing is abandoned,
  redo of older edits is always still meaningful (it's another revert).
- **Dirty tree: solved by construction.** The working tree always equals HEAD
  (every step is a commit), so there's never a checkout that clobbers WIP. We only
  guard the one moment of committing the revert (require a clean tree or stash).
- **Conflicts:** a non-latest undo can conflict. We detect it (`git revert` exits
  nonzero / leaves conflict markers) and, instead of failing silently, **hand it to
  Hearth's own agent to resolve** — "undoing 'add command palette' conflicts with a
  later change to the same file; resolve the revert." Fallback: abort cleanly
  (`git revert --abort`) and tell the user to undo the later edit first.

**Why recommended:** never loses work, no divergence or dirty-tree footguns,
matches an autonomous system that must stay safe, and the messy case (conflict)
becomes a tidy "Hearth fixes its own conflict" — perfectly on-brand. The cost is
commit-log noise, which the logical History view hides.

### Model B — Movable HEAD (checkout/reset along the line)
Undo = move HEAD back (reset/checkout); redo = move forward; new edit after undo
discards or branches the "future." Clean linear log and the "current build" marker
is literally HEAD — closest to the mock's mental model. But it reintroduces all
four hard parts as real hazards: divergence is destructive (lose undone edits
unless we stash/branch them), dirty tree blocks steps, reset --hard is dangerous on
a live app. More faithful to the picture, riskier in practice.

## Recommendation

Build **Model A** as the substrate; present it through a clean logical timeline UI
that looks like the mock (applied/undone badges, a "current build" boundary derived
from net-effect, undo/redo buttons). Treat revert conflicts as a first-class,
agent-resolvable event. Defer any literal "restore to this exact commit"
(checkout-style) to an explicit, separate "Restore" action later if we want it —
kept apart from the safe undo/redo path.

## Edge cases the implementation must handle

- **Clean-tree precondition:** before an undo/redo commit, require `REPO_ROOT`
  clean; if dirty, surface it (offer to stash, or to capture the WIP as a self-edit
  first). Normal flow keeps it clean, so this is a guard, not a common path.
- **Conflict:** detect → offer "let Hearth resolve it" (agent turn) or "undo the
  later edit first"; never leave the repo mid-revert.
- **HMR tier:** reload based on the revert commit's `diffPaths` (we already do this
  in `undo()`); `process-restart` tier uses the dev-aware restart.
- **Scope:** history is `REPO_ROOT`-only (self-evolution). Folder-workspace edits
  are never in this timeline. Commits are categorized by `Hearth-Kind`
  (code → History, soul → Personality, memory → Memory).
- **Concurrency:** serialize undo/redo with in-flight turns (don't revert mid-turn).

## Decisions (signed off)

1. **Model A** — append-only via `git revert`. ✓
2. **Conflict handling: auto-hand to Hearth's own agent to resolve** the revert
   (spawn a turn: "resolve this revert conflict"). The manual "undo later edits
   first" path is the fallback if the agent can't. ✓
3. **Literal "Restore to this point" (checkout-style jump): later** — not in this
   build; the safe undo/redo path is the only history control for now. ✓
