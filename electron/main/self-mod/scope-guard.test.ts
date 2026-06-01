import { test, expect, describe } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { classifyWrite, isCanvasPath } from './scope-guard'

const REPO = '/Users/x/Hearth'
const abs = (rel: string) => path.join(REPO, rel)

describe('classifyWrite — canvas (the agent surface)', () => {
  const canvas = [
    'src/app/chat/ChatApp.tsx',
    'src/shell/Sidebar.tsx',
    'src/styles/hearth.css',
    'electron/main/index.ts', // rest of main is editable (full Stella model)
    'electron/preload/index.ts',
    'electron.vite.config.ts',
    'package.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.hearth/personality.json', // soul is canvas
    '.hearth/memory.md', // memory is canvas
    '.hearth/scratchpad.md',
    'micro-apps/foo/App.tsx',
  ]
  for (const p of canvas) {
    test(p, () => {
      expect(classifyWrite(abs(p), REPO).tier).toBe('canvas')
      expect(isCanvasPath(abs(p), REPO)).toBe(true)
    })
  }
})

describe('classifyWrite — protected island', () => {
  const protectedPaths = [
    'electron/main/self-mod/git.ts',
    'electron/main/self-mod/scope-guard.ts',
    'electron/main/self-mod/boot-watchdog.ts',
    'electron/main/self-mod/recovery/anchor.ts',
    '.claude/settings.json',
    '.claude/hooks/block-source-writes.sh',
  ]
  for (const p of protectedPaths) {
    test(p, () => {
      expect(classifyWrite(abs(p), REPO).tier).toBe('protected')
    })
  }
})

describe('classifyWrite — hard-blocked', () => {
  test('repo secrets + internal state', () => {
    expect(classifyWrite(abs('.env'), REPO).tier).toBe('blocked')
    expect(classifyWrite(abs('.env.local'), REPO).tier).toBe('blocked')
    expect(classifyWrite(abs('auth.json'), REPO).tier).toBe('blocked')
    expect(classifyWrite(abs('.hearth/bridge-url'), REPO).tier).toBe('blocked')
    expect(classifyWrite(abs('.git/config'), REPO).tier).toBe('blocked')
  })

  test('system directories', () => {
    expect(classifyWrite('/etc/hosts', REPO).tier).toBe('blocked')
    expect(classifyWrite('/usr/local/bin/x', REPO).tier).toBe('blocked')
    expect(classifyWrite('/dev/null', REPO).tier).toBe('blocked')
  })

  test('home credential / shell-init files', () => {
    expect(classifyWrite(path.join(os.homedir(), '.ssh', 'id_rsa'), REPO).tier).toBe('blocked')
    expect(classifyWrite(path.join(os.homedir(), '.zshrc'), REPO).tier).toBe('blocked')
    expect(classifyWrite(path.join(os.homedir(), '.git-credentials'), REPO).tier).toBe('blocked')
  })
})

describe('classifyWrite — outside repo', () => {
  test('a user workspace path is canvas (not self-mod), once secret/system guards pass', () => {
    expect(classifyWrite('/Users/x/projects/other/src/main.ts', REPO).tier).toBe('canvas')
  })
})
