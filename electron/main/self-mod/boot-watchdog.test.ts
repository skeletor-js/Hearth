import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BootWatchdog } from './boot-watchdog'

let dir: string
let marker: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-watchdog-'))
  marker = join(dir, 'state', 'pending-self-mod-restart.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('BootWatchdog', () => {
  test('clean boot (no marker) → no action', () => {
    const wd = new BootWatchdog(marker)
    expect(wd.inspectBoot()).toEqual({ action: 'none' })
  })

  test('healthy restart: arm → confirmReady → next boot clean', () => {
    const wd = new BootWatchdog(marker)
    wd.arm('abc123', '1970-01-01T00:00:00.000Z')
    expect(existsSync(marker)).toBe(true)
    wd.confirmReady()
    expect(existsSync(marker)).toBe(false)
    expect(wd.inspectBoot()).toEqual({ action: 'none' })
  })

  test('bricked boot: marker survives → revert decision with attempt count', () => {
    const wd = new BootWatchdog(marker)
    wd.arm('deadbeef', '1970-01-01T00:00:00.000Z')
    // ready was never confirmed (main crashed on boot)
    expect(wd.inspectBoot()).toEqual({ action: 'revert', commit: 'deadbeef', attempt: 1 })
  })

  test('retry cap: after maxAttempts reverts, fall back to safe-mode', () => {
    const wd = new BootWatchdog(marker, 2)
    wd.arm('deadbeef', '1970-01-01T00:00:00.000Z')
    expect(wd.inspectBoot().action).toBe('revert') // attempt 1
    expect(wd.inspectBoot().action).toBe('revert') // attempt 2
    expect(wd.inspectBoot()).toEqual({ action: 'safe-mode', commit: 'deadbeef' })
  })

  test('a corrupt marker does not wedge boot', () => {
    const wd = new BootWatchdog(marker)
    wd.arm('x', '1970-01-01T00:00:00.000Z')
    // clobber with garbage
    rmSync(marker)
    mkdirSync(join(dir, 'state'), { recursive: true })
    writeFileSync(marker, '{not json')
    expect(wd.inspectBoot()).toEqual({ action: 'none' })
  })
})
