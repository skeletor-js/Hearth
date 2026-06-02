// Writable source workspace for the packaged self-evolving build (v2, option A).
//
// A signed .app bundle is read-only, but self-edits write to the renderer source
// tree and commit to git. So on first launch the packaged app copies its shipped
// source into a writable directory under userData and runs everything (Vite root,
// self-mod git) from there. node_modules is NOT copied — dependencies aren't
// self-modified — it's symlinked to the shipped, read-only copy so the workspace
// stays small and the Vite server can still resolve bare imports.
//
// In dev this module is unused: REPO_ROOT is the project checkout and Vite is
// electron-vite's own server. See docs/completed-plans/V2-PACKAGING-PLAN.md (WS2-1).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { commitAll, initBaselineRepo } from '../self-mod/git.js'

const VERSION_FILE = '.hearth-workspace-version'

export type WorkspaceAction = 'seed' | 'reuse' | 'reseed'

/**
 * What to do with the workspace, purely from its current state. 'seed' = create
 * fresh; 'reuse' = up to date, leave it; 'reseed' = a newer app version shipped,
 * lay the new baseline over the existing self-mod history. Pure — unit-tested.
 */
export function decideWorkspaceAction(p: {
  exists: boolean
  recordedVersion: string | null
  currentVersion: string
}): WorkspaceAction {
  if (!p.exists) return 'seed'
  if (p.recordedVersion !== p.currentVersion) return 'reseed'
  return 'reuse'
}

export interface EnsureWorkspaceOptions {
  /** Editable copy of Hearth's source, under userData. */
  workspaceDir: string
  /** Read-only shipped source to seed/reseed from (under resourcesPath). */
  sourceDir: string
  /** Read-only shipped node_modules to symlink in, or null to skip the link. */
  nodeModulesDir: string | null
  /** Current app version; recorded to gate reseed on upgrade. */
  version: string
}

/**
 * Ensure the writable workspace exists and matches the shipped version, then
 * return its path. Seeds on first launch, reseeds on a version bump (shipped
 * upgrade wins; prior self-mod history is preserved as commits and stays
 * revertable — a true rebase of self-mods over an upgrade is future work). Reusing
 * an up-to-date workspace touches nothing.
 */
export async function ensureWorkspace(opts: EnsureWorkspaceOptions): Promise<string> {
  const { workspaceDir, sourceDir, nodeModulesDir, version } = opts
  const marker = join(workspaceDir, VERSION_FILE)
  const action = decideWorkspaceAction({
    exists: existsSync(join(workspaceDir, '.git')),
    recordedVersion: existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null,
    currentVersion: version,
  })

  if (action === 'reuse') {
    ensureNodeModulesLink(workspaceDir, nodeModulesDir)
    return workspaceDir
  }

  mkdirSync(workspaceDir, { recursive: true })
  // Copy shipped source over the workspace, skipping node_modules (symlinked
  // separately, never copied per user) and any .git. The workspace's own .git (on
  // reseed) is untouched, so self-mod history survives.
  cpSync(sourceDir, workspaceDir, {
    recursive: true,
    force: true, // overwrite on reseed (and required for overwrite-with-filter under Bun)
    filter: (src) => {
      const rel = relative(sourceDir, src)
      return rel === '' || (!rel.startsWith('node_modules') && !rel.startsWith('.git'))
    },
  })
  writeFileSync(marker, version + '\n')
  ensureNodeModulesLink(workspaceDir, nodeModulesDir)

  if (action === 'seed') {
    await initBaselineRepo(workspaceDir, `Hearth ${version} — initial workspace`)
  } else {
    await commitAll(workspaceDir, `Hearth ${version} — upgrade baseline`)
  }
  return workspaceDir
}

/** Symlink workspace/node_modules → the shipped node_modules so the runtime Vite
 * server resolves dependencies without copying them per user. Idempotent. */
function ensureNodeModulesLink(workspaceDir: string, nodeModulesDir: string | null): void {
  if (!nodeModulesDir) return
  const link = join(workspaceDir, 'node_modules')
  if (existsSync(link)) return
  // A stale broken symlink (target gone after an app move) reports !exists; clear
  // any leftover before linking.
  rmSync(link, { force: true })
  symlinkSync(nodeModulesDir, link, 'dir')
}
