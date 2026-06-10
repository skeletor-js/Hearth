# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Shell & Sessions

### Workspace
A folder the user has registered for agents to operate in. Workspaces are registered and persisted by the main process, independent of any renderer state, which makes them the durable record that setup has happened. The Hearth repository itself is a special workspace: working in it is self-modification.

### Session
One conversation with an agent, anchored to a Workspace. A session owns a transcript that is persisted incrementally as the agent streams (never buffered until turn end), so a mid-turn reload cannot lose the turn. Exactly one session is *active* (on screen) at a time; all others are background.

### Background turn
A turn run in a session without making it active — the path Routines use, and the reason a turn can run with nobody watching. A background turn's permission asks fail closed: the ask is declined via its own reject option rather than waiting on an absent user, and the run is flagged as needing attention. Background turns serialize with foreground turns on the same workspace.

### Presence
Per-session "what is the agent doing right now" state, derived in the renderer from the agent's update stream — it drives the ambient surfaces (rail indicators, waiting banner, the while-you-were-away recap). Presence survives a self-mod renderer reload but deliberately not an app restart, and transient busy states are sanitized when restored.

### Onboarding
The first-run flow: connect an agent and choose a Workspace. Completion is recorded as a renderer-local flag, but the flag is a cache — the existence of any registered Workspace is the durable proof onboarding happened, and the shell self-heals the flag from it rather than re-asking.

### Routine
A scheduled agent task: a stored prompt plus a schedule, fired by the main process and run by the renderer as a Background turn in a fresh session. Routines fire only while the app is open; a fire that arrives while it is closed is dropped, not queued.
