# Soul (personality) & Memory — design

How Hearth's **Personality** settings and **Memory** ("remember this / forget
that") reach the agent. The rule: drive each backend's **native** instruction +
memory surface so the agent actually reads it — never a bespoke file the agent
ignores. **Status: proposal — needs sign-off before building UI-PLAN P5-2.**

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

- **Claude:** write the whole file to `$CLAUDE_CONFIG_DIR/CLAUDE.md` (Hearth owns
  the isolated `.hearth/claude-config`; auth = keychain, unaffected). Clean, global,
  zero user-file clobbering.
- **Codex:** can't isolate `CODEX_HOME` without breaking auth. Two options:
  - **(A) Managed block in `~/.codex/AGENTS.md`.** Insert/update only the delimited
    `HEARTH:managed` block; leave the user's own content intact and reversible.
    Touches a user file, but surgically.
  - **(B) Isolate `CODEX_HOME` + symlink auth.** Point `CODEX_HOME` at
    `.hearth/codex-config`, write `AGENTS.md` there, and **symlink** `~/.codex/auth.json`
    (and a minimal `config.toml`) so login still resolves. Mirrors the Claude
    approach; keeps the user's `~/.codex` pristine. Nuance: a symlink isn't reading
    or storing the token (codex reads its own credential through the link), but it's
    credential-adjacent — flagging per COMPLIANCE.

**Memory** is the `## Memory` section above (so it's read natively every session,
no special tool needed). "Remember/forget" = the agent edits that section via its
normal file tools; Settings → "Open memory" reveals it. One global memory to start
(per-workspace memory can come later). *(Optional augmentation: also surface
Claude's native per-project `MEMORY.md` when on Claude — but the unified Hearth
section is the cross-backend source of truth.)*

**Soul** is regenerated whenever Personality settings change; the user never
hand-edits it (matches the handoff's "compiles to a soul Hearth reads").

Because these are just instruction files under Hearth's control, **Hearth can
self-edit its own soul/ops** — on-brand, and they can be versioned with the repo
or kept as runtime state (decision 3).

## Decisions needed from you

1. **Codex delivery: (A) managed block in `~/.codex/AGENTS.md`, or (B) isolated
   `CODEX_HOME` + symlinked auth?** (Recommend **B** — symmetric with Claude, keeps
   the user's `~/.codex` untouched; accept the symlink nuance. Pick **A** if you'd
   rather not touch anything auth-adjacent.)
2. **Memory scope:** one global memory now (recommend), with per-workspace memory
   later — yes? And do we also feed Claude's native `MEMORY.md` when on Claude, or
   keep the single Hearth section as the only source of truth (recommend single)?
3. **Soul/memory storage:** runtime state under `.hearth/` (gitignored), or
   committed into the repo so self-edits to the soul are versioned in History?
   (Recommend: memory = runtime/gitignored; soul = your call — versioning it makes
   "Hearth changed its own personality" show up in History, which is kind of great.)
