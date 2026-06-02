import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
// dugite's exec runs git via an argv array with NO shell (no injection surface);
// aliased to gitExec to make that explicit.
import { exec as gitExec } from 'dugite'
import { SelfModService } from './self-mod-service.js'
import { HmrController } from './hmr.js'
import type { ReloadKind } from './path-relevance.js'

async function git(repo: string, args: string[]) {
  const r = await gitExec(args, repo)
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

function write(repo: string, rel: string, content: string) {
  const p = join(repo, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}

// A reload driver that records what the HMR controller asked for, so we can
// assert the tier without an Electron window.
function recordingHmr() {
  const calls: string[] = []
  const hmr = new HmrController({
    reloadWindow: () => calls.push('reload'),
    restartApp: () => calls.push('restart'),
    coveredReload: () => calls.push('covered'),
  })
  return { hmr, calls }
}

let repo: string
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hearth-selfmod-'))
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'test@hearth.dev'])
  await git(repo, ['config', 'user.name', 'Hearth Test'])
  await git(repo, ['config', 'commit.gpgsign', 'false'])
  write(repo, 'src/app/chat/ChatApp.tsx', 'export const title = "Hearth"\n')
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '-m', 'baseline'])
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('SelfModService.captureTurn', () => {
  test('no changes -> null, no reload', async () => {
    const { hmr, calls } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    expect(await svc.captureTurn('conv-1', 'did nothing')).toBeNull()
    expect(calls).toEqual([])
  })

  test('a renderer edit commits with the conversation trailer and stays HMR tier', async () => {
    const { hmr, calls } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/app/chat/ChatApp.tsx', 'export const title = "Hearth ✨"\n')

    const result = await svc.captureTurn('conv-42', 'change the title')
    expect(result).not.toBeNull()
    expect(result!.changedPaths).toContain('src/app/chat/ChatApp.tsx')
    expect(result!.reload).toBe<ReloadKind>('hmr')
    expect(calls).toEqual([]) // hmr tier = Vite already hot-swapped, no window reload

    const body = await git(repo, ['log', '-1', '--pretty=%B'])
    expect(body).toContain('change the title')
    expect(body).toContain('Hearth-Conversation: conv-42')
    expect(body).toContain('Hearth-SelfMod: true')
  })

  test('a route edit escalates to a full window reload', async () => {
    const { hmr, calls } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/routes/settings.tsx', 'export const Route = {}\n')

    const result = await svc.captureTurn('conv-7', 'add settings route')
    expect(result!.reload).toBe<ReloadKind>('full-reload')
    expect(calls).toEqual(['reload'])
  })

  test('under Vite, a full-reload edit goes through the covered (morph) reload', async () => {
    // The autonomous Vite reload is suppressed during a turn (B6), so the controller
    // triggers the reload behind the morph cover (B5) — not a bare reloadWindow.
    const calls: string[] = []
    const hmr = new HmrController(
      {
        reloadWindow: () => calls.push('reload'),
        restartApp: () => calls.push('restart'),
        coveredReload: () => calls.push('covered'),
      },
      true, // viteServed
    )
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/routes/settings.tsx', 'export const Route = {}\n')

    const result = await svc.captureTurn('conv-7b', 'add settings route')
    expect(result!.reload).toBe<ReloadKind>('full-reload')
    expect(calls).toEqual(['covered']) // morph cover + reload, not a bare reload
  })

  test('commits ONLY what changed during the turn, not pre-existing dirty files', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)

    // The developer was already editing this when the turn started.
    write(repo, 'src/dev-wip.tsx', 'unfinished dev work\n')
    const before = await svc.dirtyPaths()
    expect(before).toContain('src/dev-wip.tsx')

    // The agent turn edits a different file.
    write(repo, 'src/agent-edit.tsx', 'agent change\n')
    const result = await svc.captureTurn('conv-x', 'agent edit', before)

    // Only the agent's file is committed; the dev's WIP stays dirty + uncommitted.
    expect(result!.changedPaths).toEqual(['src/agent-edit.tsx'])
    expect(await svc.dirtyPaths()).toEqual(['src/dev-wip.tsx'])
  })
})

describe('SelfModService.undo', () => {
  test('reverts the edit, reports the reverted files, and restores content', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)

    const file = 'src/app/chat/ChatApp.tsx'
    write(repo, file, 'export const title = "Changed"\n')
    const commit = await svc.captureTurn('conv-1', 'change title')
    expect(readFileSync(join(repo, file), 'utf-8')).toContain('Changed')

    // The bug this guards: undo used to read listDirty *after* the revert
    // already committed, so changedPaths came back empty. It must reflect the
    // files the revert touched.
    const undo = await svc.undo(commit!.commit)
    expect(undo.changedPaths).toContain(file)
    expect(undo.reload).toBe<ReloadKind>('hmr')
    expect(readFileSync(join(repo, file), 'utf-8')).toContain('Hearth')
    expect(readFileSync(join(repo, file), 'utf-8')).not.toContain('Changed')
  })

  test('undoing a route edit escalates the reload tier from the revert diff', async () => {
    const { hmr, calls } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/routes/settings.tsx', 'export const Route = {}\n')
    const commit = await svc.captureTurn('conv-2', 'add route')
    calls.length = 0

    const undo = await svc.undo(commit!.commit)
    expect(undo.changedPaths).toContain('src/routes/settings.tsx')
    expect(undo.reload).toBe<ReloadKind>('full-reload')
    expect(calls).toEqual(['reload'])
  })
})

describe('SelfModService.history', () => {
  test('lists self-mod commits with their conversation id', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/a.tsx', 'a\n')
    await svc.captureTurn('conv-A', 'edit a')
    write(repo, 'src/b.tsx', 'b\n')
    await svc.captureTurn('conv-B', 'edit b')

    const history = await svc.history()
    expect(history.length).toBe(2)
    expect(history[0]).toMatchObject({ subject: 'edit b', conversationId: 'conv-B' })
    expect(history[1]).toMatchObject({ subject: 'edit a', conversationId: 'conv-A' })
  })

  test('an entry is flagged reverted once it has been undone', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/c.tsx', 'c\n')
    const captured = await svc.captureTurn('conv-C', 'edit c')

    expect((await svc.history())[0].reverted).toBe(false)

    await svc.undo(captured!.commit)

    const after = await svc.history()
    expect(after).toHaveLength(1) // the revert commit isn't itself a self-mod
    expect(after[0]).toMatchObject({ subject: 'edit c', reverted: true })
  })
})

describe('SelfModService — per-subagent commits (W2)', () => {
  test('a multi-group run produces one commit per file-disjoint group, grouped by runId', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/shell/Rail.tsx', 'rail\n')
    write(repo, 'src/shell/Topbar.tsx', 'top\n')
    const before = await svc.dirtyPaths().then(() => [])

    const result = await svc.captureTurn('conv-1', 'parallel edit', before, {
      runId: 'run-1',
      groups: [
        { paths: ['src/shell/Rail.tsx'], subagentLabel: 'Left sidebar', labels: ['taskA'] },
        { paths: ['src/shell/Topbar.tsx'], subagentLabel: 'Heading', labels: ['taskB'] },
      ],
    })

    expect(result!.commits).toHaveLength(2)
    const history = await svc.history()
    expect(history.length).toBe(2)
    for (const e of history) {
      expect(e.runId).toBe('run-1')
    }
    const subjects = history.map((e) => e.subject).sort()
    expect(subjects).toEqual(['Heading: parallel edit', 'Left sidebar: parallel edit'])
    const subagents = history.map((e) => e.subagent).sort()
    expect(subagents).toEqual(['Heading', 'Left sidebar'])
  })

  test('a dirty path missed by the stream is reconciled into a main group', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/tracked.tsx', 't\n')
    write(repo, 'src/missed.tsx', 'm\n') // not in any group (e.g. a shell write)

    const result = await svc.captureTurn('conv-1', 'edit', [], {
      runId: 'run-2',
      groups: [{ paths: ['src/tracked.tsx'], subagentLabel: 'taskA', labels: ['taskA'] }],
    })

    expect(result!.commits).toHaveLength(2) // taskA group + reconciled main group
    const allPaths = (await svc.history()).flatMap((e) => e.subject)
    expect(allPaths.length).toBe(2)
  })

  test('incomplete-run recovery commits orphaned changes when a marker is present', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    // simulate a crashed turn: marker written, changes left uncommitted
    svc.beginTurn()
    write(repo, 'src/orphan.tsx', 'orphan\n')

    const recovered = await svc.recoverIfIncomplete('conv-1')
    expect(recovered).not.toBeNull()
    expect(recovered!.changedPaths).toContain('src/orphan.tsx')
    const history = await svc.history()
    expect(history[0].subject).toContain('recovered')
  })

  test('no marker → dirty tree is left as dev WIP, not recovered', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/wip.tsx', 'wip\n')
    expect(await svc.recoverIfIncomplete('conv-1')).toBeNull()
  })
})

describe('SelfModService — commit-time scope enforcement (W7)', () => {
  test('writes to the protected island are restored and not committed; canvas commits', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, 'src/ok.tsx', 'canvas edit\n') // canvas → allowed
    write(repo, 'electron/main/self-mod/evil.ts', 'disarm guardrails\n') // protected → rejected

    const result = await svc.captureTurn('conv-1', 'mixed edit', [])
    expect(result!.rejectedPaths).toEqual(['electron/main/self-mod/evil.ts'])
    expect(result!.changedPaths).toEqual(['src/ok.tsx'])
    // the protected new file was removed from the working tree
    expect(existsSync(join(repo, 'electron/main/self-mod/evil.ts'))).toBe(false)
    // only the canvas edit landed in history
    const history = await svc.history()
    expect(history).toHaveLength(1)
    expect(history[0].subject).toBe('mixed edit')
  })

  test('a turn that ONLY touches blocked/protected paths commits nothing', async () => {
    const { hmr } = recordingHmr()
    const svc = new SelfModService(repo, hmr)
    write(repo, '.env', 'SECRET=1\n') // hard-blocked
    const result = await svc.captureTurn('conv-1', 'sneaky', [])
    expect(result!.commits).toEqual([])
    expect(result!.rejectedPaths).toEqual(['.env'])
    expect(existsSync(join(repo, '.env'))).toBe(false)
    expect(await svc.history()).toHaveLength(0)
  })
})
