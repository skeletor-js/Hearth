// Workspace payload delivery for the packaged build (packaging v3).
//
// The signed shell no longer bundles the renderer source + its node_modules.
// Instead it downloads a "workspace payload" (index.html + src + the renderer's
// node_modules) from a Cloudflare R2 feed, verifies its sha256, extracts it into
// a writable dir, and seeds the workspace from it. This keeps the signed bundle
// small (it signs/notarizes normally) and lets the heavy, self-modifying payload
// live unsigned in userData — the Stella model (signed shell + downloaded app).
// See docs/PACKAGING-V3-PLAN.md.
//
// The extracted payload is reused across launches; a new manifest version triggers
// a fresh download. `ensureWorkspace` (workspace.ts) still does the actual seed/
// reseed + git baseline from the extracted dir, unchanged.

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { ensureWorkspace } from './workspace.js'

/** Feed manifest published next to the payload tarballs (workspace/current.json). */
export interface PayloadManifest {
  schemaVersion: number
  version: string
  commit?: string
  /** Shell versions older than this can't run the payload; prompt a shell update. */
  minShellVersion?: string
  asset: { url: string; sha256: string; sizeBytes?: number }
}

/** No payload locally and the feed is unreachable — can't finish first-run setup. */
export class NeedsNetworkError extends Error {}
/** The payload requires a newer shell than this one. */
export class ShellTooOldError extends Error {}

export type ProgressPhase = 'download' | 'extract' | 'install'
export interface Progress {
  phase: ProgressPhase
  /** 0–100 during download (when content-length is known). */
  percent?: number
}

const DEFAULT_MANIFEST_URL =
  process.env.HEARTH_WORKSPACE_MANIFEST_URL ??
  'https://pub-aacb176d4db84288936664754f7f6c5b.r2.dev/workspace/current.json'

const DOWNLOAD_ATTEMPTS = 5
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Compare dotted numeric versions (e.g. 0.1.0). Non-numeric tails are ignored. */
export function versionLt(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da < db
  }
  return false
}

async function fetchManifest(url: string): Promise<PayloadManifest> {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`)
  return (await res.json()) as PayloadManifest
}

const normalizeSha = (s: string) => s.toLowerCase().replace(/^sha256:/, '')

/** Stream a URL to a file, hashing as we go; retry a few times; verify sha256. */
async function downloadToFile(
  url: string,
  dest: string,
  expectedSha: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      const hash = createHash('sha256')
      const out = createWriteStream(dest)
      let received = 0
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        await new Promise<void>((resolve, reject) =>
          out.write(Buffer.from(value), (e) => (e ? reject(e) : resolve())),
        )
        received += value.length
        if (total && onProgress) onProgress(Math.round((received / total) * 100))
      }
      await new Promise<void>((resolve) => out.end(resolve))
      const got = hash.digest('hex')
      if (normalizeSha(got) !== normalizeSha(expectedSha)) {
        throw new Error(`sha256 mismatch (expected ${normalizeSha(expectedSha)}, got ${got})`)
      }
      return
    } catch (err) {
      lastErr = err
      rmSync(dest, { force: true })
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(1000 * attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Extract a .tar.gz into destDir (tar v7 auto-detects gzip). */
async function extractTarGz(file: string, destDir: string): Promise<void> {
  const tar = await import('tar')
  await tar.x({ file, cwd: destDir })
}

/** Best-effort: clear the quarantine xattr so downloaded native modules can load. */
function stripQuarantine(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('xattr', ['-dr', 'com.apple.quarantine', dir], { stdio: 'ignore' })
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
}

/** Download + verify + extract the payload for `manifest.version` if not already present. */
async function ensurePayloadExtracted(
  payloadsDir: string,
  manifest: PayloadManifest,
  onProgress?: (p: Progress) => void,
): Promise<string> {
  const payloadDir = join(payloadsDir, manifest.version)
  if (existsSync(join(payloadDir, '.complete'))) return payloadDir

  mkdirSync(payloadsDir, { recursive: true })
  const tarFile = join(payloadsDir, `${manifest.version}.tar.gz.download`)
  onProgress?.({ phase: 'download', percent: 0 })
  await downloadToFile(manifest.asset.url, tarFile, manifest.asset.sha256, (percent) =>
    onProgress?.({ phase: 'download', percent }),
  )

  onProgress?.({ phase: 'extract' })
  const tmpDir = `${payloadDir}.extract`
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  await extractTarGz(tarFile, tmpDir)
  await stripQuarantine(tmpDir)
  rmSync(tarFile, { force: true })

  rmSync(payloadDir, { recursive: true, force: true })
  renameSync(tmpDir, payloadDir)
  writeFileSync(join(payloadDir, '.complete'), `${manifest.commit ?? manifest.version}\n`)
  return payloadDir
}

/** Remove extracted payloads other than the ones we still need (current + prev). */
function gcOldPayloads(payloadsDir: string, keep: string[]): void {
  if (!existsSync(payloadsDir)) return
  const keepSet = new Set(keep.filter(Boolean))
  for (const name of readdirSync(payloadsDir)) {
    if (keepSet.has(name)) continue
    rmSync(join(payloadsDir, name), { recursive: true, force: true })
  }
}

export interface EnsureFromManifestOptions {
  /** Writable workspace the app runs from (userData/workspace). */
  workspaceDir: string
  /** Where extracted payloads are cached (userData/payloads). */
  payloadsDir: string
  /** This shell's version, gated against manifest.minShellVersion. */
  shellVersion: string
  /** Override the feed URL (tests / staging). */
  manifestUrl?: string
  onProgress?: (p: Progress) => void
}

/**
 * Resolve the workspace by ensuring the manifest's payload is downloaded and
 * extracted, then seeding the workspace from it via `ensureWorkspace`. Offline-
 * tolerant once a workspace exists; throws NeedsNetworkError on a cold first run
 * with no network. Returns the workspace path.
 */
export async function ensureWorkspaceFromManifest(opts: EnsureFromManifestOptions): Promise<string> {
  const { workspaceDir, payloadsDir, shellVersion, onProgress } = opts
  const manifestUrl = opts.manifestUrl ?? DEFAULT_MANIFEST_URL
  const workspaceExists = existsSync(join(workspaceDir, '.git'))
  const recorded = existsSync(join(workspaceDir, '.hearth-workspace-version'))
    ? readFileSync(join(workspaceDir, '.hearth-workspace-version'), 'utf8').trim()
    : null

  let manifest: PayloadManifest
  try {
    manifest = await fetchManifest(manifestUrl)
  } catch (err) {
    // Offline: keep running the workspace we already have; only fail a cold start.
    if (workspaceExists && recorded) {
      const prev = join(payloadsDir, recorded)
      if (existsSync(join(prev, '.complete'))) {
        return ensureWorkspace({ workspaceDir, sourceDir: prev, nodeModulesDir: join(prev, 'node_modules'), version: recorded })
      }
      return workspaceDir
    }
    throw new NeedsNetworkError(
      `Hearth needs an internet connection to finish first-time setup. (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  if (manifest.minShellVersion && versionLt(shellVersion, manifest.minShellVersion)) {
    if (workspaceExists && recorded) return workspaceDir // keep running what we have
    throw new ShellTooOldError(
      `This installer is older than the current Hearth (needs ${manifest.minShellVersion}+). Update the app and reopen.`,
    )
  }

  const payloadDir = await ensurePayloadExtracted(payloadsDir, manifest, onProgress)
  onProgress?.({ phase: 'install' })
  const ws = await ensureWorkspace({
    workspaceDir,
    sourceDir: payloadDir,
    nodeModulesDir: join(payloadDir, 'node_modules'),
    version: manifest.version,
  })
  gcOldPayloads(payloadsDir, [manifest.version, recorded ?? ''])
  return ws
}
