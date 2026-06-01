# Soul (personality) & Memory — design

How Hearth's **Personality** settings and **Memory** ("remember this / forget
that") reach the agent. The rule: drive each backend's **native** instruction +
memory surface so the agent actually reads it — never a bespoke file the agent
ignores. **Status: SIGNED OFF — build per this doc (UI-PLAN P5-2).**

## How the backends natively handle it

| | Claude Code | Codex |
|---|---|---|
| Global instructions | `$CLAUDE_CONFIG_DIR/CLAUDE.md` (+ SDK `appendSystemPrompt`) | `$CODEX_HOME/AGENTS.md` (+ `config.toml`) |
| Project instructions | `<cwd>/CLAUDE.md`, `<cwd>/.claude/` | `<cwd>/AGENTS.md` (hierarchical up the tree) |
| Memory | memory tool → per-project `~/.claude/projects/<p>/memory/MEMORY.md`; also CLAUDE.md | no structured memory tool — lives in `AGENTS.md` |
| Auth location | macOS **Keychain** (config-dir-independent) | **file**: `~/.codex/auth.json` |

Both load global + project instructions and compose them. The asymmetry that
drives the design: **Hearth can safely own Claude's config dir** (auth is keychain,
and we already isolate `CLAUDE_CONFIG_DIR`), but **owning Codex's `CODEX_HOME`
would strand its file-based login.**

## What Hearth needs to deliver, globally (every session, any workspace)

1. **Hearth operating instructions** — self-edit/`view_app`/control/multi-workspace
   guidance. *(Today these sit in the repo's `CLAUDE.md`/`AGENTS.md` at the cwd —
   which means they DON'T apply when a session's cwd is a folder workspace. Bug.
   They belong in the global instruction surface.)*
2. **Soul** — personality compiled from Settings (response length · directness ·
   formatting density) into a short instruction block.
3. **Memory** — the user's durable "how I like to work / remember X" notes, read
   every session and updated on "remember/forget".

All three are **global** (the "one ongoing relationship" framing), composing with
whatever project-level `CLAUDE.md`/`AGENTS.md` a folder workspace already has.

## Proposal

Hearth maintains one generated instruction document per backend, written to that
backend's **native global instructions file**, structured as managed sections:

```
<!-- HEARTH:managed — generated, do not edit by hand -->
## Hearth operating instructions   (self-edit, view_app/control, workspaces)
## Soul                            (compiled from Personality settings)
## Memory                          (the durable notes; agent appends on remember/forget)
<!-- /HEARTH:managed -->
```

**One mechanism, both backends ("A" everywhere).** The same idempotent
managed-block writer targets whichever file the backend actually reads as global
instructions:
- **Claude:** the `CLAUDE.md` in Hearth's isolated `.hearth/claude-config`
  (CLAUDE_CONFIG_DIR). Hearth owns the dir, so there's no user content to preserve —
  but we still structure it as the managed block for consistency. Keychain auth
  unaffected.
- **Codex:** `~/.codex/AGENTS.md`. We do **not** isolate `CODEX_HOME` (file-based
  auth lives there and just works), and write **only** the delimited `HEARTH:managed`
  block, leaving the user's own content intact and reversible.

This avoids the symlink-auth nuance entirely and is a single code path.

**Memory — global + per-workspace.** Single source of truth is Hearth's managed
blocks (we do NOT also drive Claude's native `MEMORY.md` tool):
- **Global memory** → the `## Memory` section of the global instruction file above
  (read in every session).
- **Per-workspace memory** → a `HEARTH:memory` managed block in *that workspace's*
  project instruction file (`<cwd>/CLAUDE.md` / `<cwd>/AGENTS.md`), composing
  natively with the global one and applying only in that workspace. For the Hearth
  repo it's the repo's own file (committed); for a folder workspace it's a surgical
  block in that folder.
- "Remember/forget" edits the right block (this-workspace by default, or global if
  the user says so) via the agent's normal file tools; Settings → Memory reveals them.

**Soul** is regenerated whenever Personality settings change; the user never
hand-edits it.

**Versioning + IA (decision 3).** Hearth's **global soul + global memory are
committed** in the Hearth repo, so changes are versioned. But they are conceptually
distinct from code self-edits, so each self-mod commit is **categorized**
(`Hearth-Kind: code | soul | memory`, derived from which managed files changed) and
routed to a distinct surface:
- **History** — the timeline of *code/UI/skill* self-modifications (undo/redo per
  [SELF-EVOLUTION-HISTORY.md](SELF-EVOLUTION-HISTORY.md)).
- **Personality** — soul changes (their own versioned history).
- **Memory** — memory changes (their own versioned history).

So "Hearth changed its own personality/memory" shows up under Personality/Memory,
not mixed into the code History timeline. (Per-workspace memory for folder workspaces
lives with that folder, not in the Hearth repo's history.)

## Decisions (signed off)

1. **Delivery: "A" (managed block) for BOTH backends** — one writer, targeting each
   backend's effective global instructions file (Claude's isolated
   `CLAUDE_CONFIG_DIR/CLAUDE.md`; the user's `~/.codex/AGENTS.md` with a surgical
   block). No `CODEX_HOME` isolation, no symlink. ✓
2. **Memory: global AND per-workspace, both now.** Single source of truth = Hearth's
   managed blocks; do NOT also drive Claude's native `MEMORY.md`. ✓
3. **Versioned + split IA:** global soul + global memory are **committed** in the
   Hearth repo. Self-mod commits are **categorized** (`Hearth-Kind: code|soul|memory`)
   and shown under three distinct surfaces — **History** (code), **Personality**
   (soul), **Memory** (memory) — never mixed. ✓
