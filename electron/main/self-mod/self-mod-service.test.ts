import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
})
