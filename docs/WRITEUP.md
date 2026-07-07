# Hearth: a coding agent that can see, drive, and rewrite its own client

I built a desktop client for coding agents that lets the agent edit its own
running interface, drive that interface the way a user would, and revert anything
it does. The big labs explicitly forbid this. For a single trusted user on their
own machine, the reasons they forbid it mostly do not apply, so I wanted to see
what the thing actually feels like when you build it. This is a writeup of the
result and, more interestingly, of the safety machinery that makes it something
other than a footgun.

## What the labs say

OpenAI's Codex computer-use docs are direct about it. Codex "can't automate
terminal apps or Codex itself, since automating them could bypass Codex security
policies." Anthropic's computer-use tiers land in the same place from the other
direction: browsers are view-only, and nothing in the model is allowed to drive
the client that hosts it. The generic agent-in-a-GUI layer is by now well
covered. Claude Code got a desktop redesign, Codex has an app, there is Conductor,
Devin Desktop, opencode, and a long tail of others. None of them let the agent
reach back through the glass and change the app it is running inside.

The prohibition is correct for a hosted product. If you are running an agent on
behalf of many users through a shared subscription, an agent that can automate its
own client can bypass the controls that keep those users apart, and you cannot
audit every path it might take. So the rule is a floor, not a ceiling. It is set
for the multi-tenant case.

Hearth is not that case. It runs on my laptop, drives the agent I already
authenticated with `claude login`, touches only files in one repo, and commits
every change. The threat model for one person editing their own tool is not the
threat model for a platform. So the interesting question is not "is self-control
dangerous," it is "what has to be true for it to be recoverable," and that turns
out to be a concrete engineering problem with a concrete answer.

## What it does

Hearth is an Electron app. The main process is Node. The renderer is a React app
served by a live Vite dev server, not a frozen bundle. That one decision is the
whole trick. Because the renderer is served by a running dev server, an agent that
edits renderer source on disk gets hot module reload for free, and the change
shows up in the live window with no restart. Self-editing is not a feature I wrote.
It falls out of running the app as its own dev environment.

So you can say "add a Stats item to the sidebar" or "make this panel roomier," and
the agent edits the app's own source and the UI reshapes in front of you. Every
such edit is a git commit with a `Hearth-SelfMod` marker, listed in a Changes view
with one-click undo. Nothing it does is permanent.

The second half is that the agent can also see and drive the app. Hearth exposes a
small MCP server to whichever agent is running. It has tools like `view_app`
(screenshot the live window, or render and capture a specific route in a hidden
window without disturbing what you are looking at), `read_ui` (list the interactive
elements with selectors), and `click` / `fill` / `eval_js` to act on them. The
`eval_js` tool runs in the renderer with the DOM and the full IPC surface
available, so the agent can do anything a user could: send a prompt, undo a
self-mod, start a micro-app, switch backends. There is an embedded browser it can
drive the same way. The loop the agent runs is the same loop I would: look, act,
look again to confirm.

## Why it is not a footgun

If you let an agent rewrite the process it runs in, the obvious failure is that it
breaks itself and now you have no app and no way to ask it to fix the app. The
design answer is that safety comes from recoverability, not from fencing the agent
out. The agent can edit almost anything, including the rest of the main process.
What it cannot do is disarm the parts that let you recover.

There is a **scope guard** that classifies every write into three tiers. Blocked
paths are never writable: secrets, credential and shell-init files, system
directories, the git internals. The **protected island** is the self-mod engine
itself, the boot watchdog, and the managed hook config. Those are editable only
with explicit user approval, and the island is written to be dependency-free, node
builtins only, so the agent cannot break a guardrail indirectly by editing
something it imports. Everything else is the canvas, the agent's free surface. The
guard is a real choke point because writes route through Hearth's own file
capability. Shell writes that try to go around it get forced back onto the mediated
path by a hook on Claude and a permission reject on Codex, with a file-watch
backstop behind that.

Renderer edits hot-reload and are cheap to undo. Main-process edits cannot
hot-reload, so they ride a guarded path: a blocking typecheck before the restart,
and a **boot watchdog** behind it. The watchdog arms a marker recording the commit
right before a self-mod restart, and clears it only when boot reaches a healthy
ready state. If the next boot finds the marker still there, the previous restart
never came up, which means that edit bricked startup, so the watchdog auto-reverts
that commit and relaunches. A bounded attempt count keeps a poisoned revert from
looping into its own crash. This is the case the renderer crash surface cannot
handle, because when main is down the renderer is down too, so the recovery has to
live in the boot path itself.

One more piece that took real work: parallel edits. When a single agent edits, the
change hot-swaps immediately. The moment two or more subagents write concurrently,
a snapshot-overlay Vite plugin pins their pre-edit baselines and swaps the whole
batch in atomically, so the live UI never shows a half-applied state where one file
is new and another is old. A turn becomes file-disjoint commits, one group per
subagent, so overlapping work is still independently undoable.

The auth boundary matters too. Hearth spawns the agent I already authenticated in
my own environment and never renders a login screen or stores a token. That is what
keeps it in the "editor driving Claude Code" lane rather than the "third-party app
routing requests through someone's subscription" lane the terms actually care
about. The bridge the MCP server talks to is loopback only, pinned to a per-boot
token and a fixed Host, and the agent windows are sandboxed.

## What it is not

It is not a product. It is a personal project, version 0.1.0, macOS on Apple
Silicon, roughly 23k lines with 475 passing tests covering the parts that
would hurt if they broke: ACP translation, git, the scope guard, the boot watchdog,
the classifier. Use it at your own risk.

It is not competing with Claude Code Desktop or the Codex app. Those are polished
clients for using an agent. Hearth is a working artifact of a narrower idea, that
software can be malleable at the seam where you use it, and that the person using a
tool should be able to reshape it by asking. The academic self-modifying-agent work
I know of is headless. The "self-evolving" agents elsewhere usually mean an agent
that edits its skills or memory files, not one that rewrites the source and UI of
the client it lives in and reloads it live. That specific thing, an agent editing,
driving, and reverting its own running client, I could not find shipped anywhere,
partly because the people best positioned to ship it are the ones whose terms
forbid it.

## Come poke at it

The code is open, Apache-2.0. The interesting reading is
`electron/main/self-mod/`, especially `scope-guard.ts` and `boot-watchdog.ts`, and
the overlay plugin under `electron/vite-plugins/`. If you think the recoverability
argument has a hole, I would like to know where. The most useful thing you can do
is try to get the agent to brick the app in a way the watchdog and the scope guard
do not catch. If you find one, that is the bug worth reporting.
