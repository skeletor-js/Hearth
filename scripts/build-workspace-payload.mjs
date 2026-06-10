#!/usr/bin/env node
// Build + publish the workspace payload: the renderer source + its node_modules
// that the packaged app downloads instead of bundling (packaging v3). Produces a
// .tar.gz, computes its sha256, writes a `current.json` manifest, and uploads both
// to the R2 feed under `workspace/`. The signed shell never contains this.
//
// Layout on R2 (base = package.json build.publish[0].url):
//   workspace/current.json
//   workspace/releases/<version>/hearth-workspace-<version>.tar.gz
//
// Required env (build machine only — see .env.release):
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  [, R2_PREFIX]
//
// Usage:  bun run payload:build   (after `bun run build` so src is current)

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const tar = require('tar')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const publishBase = pkg.build?.publish?.[0]?.url
if (!publishBase) {
  console.error('[payload] no build.publish[0].url in package.json — set the R2 public URL first.')
  process.exit(1)
}

const DRY_RUN = process.env.PAYLOAD_DRY_RUN === '1'
const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX = '' } = process.env
const missing = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !process.env[k])
if (!DRY_RUN && missing.length) {
  console.error(`[payload] missing env: ${missing.join(', ')} (load .env.release)`)
  process.exit(1)
}

// The payload ships ONLY what the renderer can resolve at runtime (U9): the
// bare specifiers imported under src/ + index.html, plus their full dependency
// closure walked from the local node_modules. The old approach (everything
// minus a denylist) shipped the dev machine's whole tree — test tooling,
// @aws-sdk, whatever happened to be installed — to every user by default.
// A closure miss fails loudly at packaged-app boot (renderer import error),
// never silently. Two-channel placement rule: docs/PACKAGING-CHANNELS.md.

/** Bare package name of an import specifier ('@scope/pkg/sub' → '@scope/pkg'). */
function packageNameOf(spec) {
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/')
    return name ? `${scope}/${name}` : null
  }
  return spec.split('/')[0]
}

/** Bare specifiers imported by the staged renderer source (ts/tsx/css/html). */
function rendererSeeds(stageDir) {
  const seeds = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(tsx?|css|html)$/.test(entry.name)) {
        const text = readFileSync(p, 'utf8')
        // import/export-from/dynamic-import + CSS @import. Relative paths, the
        // '@/' src alias, and node:/electron builtins are not packages.
        for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*|@import\s+)['"]([^'"\n]+)['"]/g)) {
          const spec = m[1]
          if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('node:')) continue
          const name = packageNameOf(spec)
          if (name) seeds.add(name)
        }
      }
    }
  }
  walk(stageDir)
  return seeds
}

/** Seeds + every package reachable through dependencies/peers/optionals that
 * actually exist in node_modules (peers are hoisted beside their dependents). */
function dependencyClosure(seeds, nmDir) {
  const closure = new Set()
  const queue = [...seeds]
  while (queue.length) {
    const name = queue.shift()
    if (closure.has(name)) continue
    const pkgJson = join(nmDir, name, 'package.json')
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
    } catch {
      continue // not installed (e.g. an optional peer) — nothing to ship
    }
    closure.add(name)
    for (const dep of [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]) {
      if (!closure.has(dep)) queue.push(dep)
    }
  }
  return closure
}

// Packages that must never reach the payload — their presence in the closure
// means a seed (or a dependency edge) is wrong, not that the list needs a tweak.
const FORBIDDEN = ['electron', 'electron-builder', '@aws-sdk/client-s3', 'tar']

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  } catch {
    return undefined
  }
})()

console.log(`[payload] staging workspace payload for ${version}…`)
const stage = mkdtempSync(join(tmpdir(), 'hearth-payload-'))
try {
  cpSync(join(root, 'index.html'), join(stage, 'index.html'))
  cpSync(join(root, 'src'), join(stage, 'src'), { recursive: true })

  const nmSrc = join(root, 'node_modules')
  const seeds = rendererSeeds(stage)
  const closure = dependencyClosure(seeds, nmSrc)
  const banned = FORBIDDEN.filter((p) => closure.has(p))
  if (banned.length) {
    console.error(`[payload] refusing to ship packaging/build tooling in the payload: ${banned.join(', ')}`)
    console.error('[payload] a renderer seed (or a dependency edge) is wrong — fix the import, not this list.')
    process.exit(1)
  }
  console.log(`[payload] ${seeds.size} renderer seeds → ${closure.size} packages:`)
  console.log([...closure].sort().map((p) => `  ${p}`).join('\n'))

  for (const name of closure) {
    const from = join(nmSrc, name)
    cpSync(from, join(stage, 'node_modules', name), {
      recursive: true,
      filter: (src) => {
        // Skip broken symlinks so they don't leave dead links in the payload.
        try {
          if (lstatSync(src).isSymbolicLink()) return statSync(src), true
        } catch {
          return false
        }
        return true
      },
    })
  }

  const releaseDir = join(root, 'release')
  mkdirSync(releaseDir, { recursive: true })
  const tarName = `hearth-workspace-${version}.tar.gz`
  const tarPath = join(releaseDir, tarName)
  console.log('[payload] creating tarball…')
  // Archive the staged contents at the root (no wrapping dir), gzip.
  tar.c({ sync: true, gzip: true, file: tarPath, cwd: stage }, ['index.html', 'src', 'node_modules'])

  const buf = readFileSync(tarPath)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const sizeBytes = buf.length
  const assetUrl = `${publishBase.replace(/\/$/, '')}/workspace/releases/${version}/${tarName}`
  const manifest = { schemaVersion: 1, version, commit, asset: { url: assetUrl, sha256, sizeBytes } }
  console.log(`[payload] ${tarName} — ${(sizeBytes / 1e6).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…`)

  if (DRY_RUN) {
    console.log('[payload] DRY RUN — not uploading. Manifest would be:')
    console.log(JSON.stringify(manifest, null, 2))
    process.exit(0)
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })
  const keyBase = R2_PREFIX ? `${R2_PREFIX.replace(/\/$/, '')}/` : ''
  const put = (key, body, type, cache) =>
    s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: keyBase + key, Body: body, ContentType: type, CacheControl: cache }))

  await put(`workspace/releases/${version}/${tarName}`, buf, 'application/gzip', 'public, max-age=31536000, immutable')
  await put('workspace/current.json', JSON.stringify(manifest, null, 2), 'application/json', 'no-cache, max-age=0, must-revalidate')
  console.log(`[payload] published. Clients on shell ${version}+ will fetch this on next launch.`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
