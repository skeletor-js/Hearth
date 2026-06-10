#!/usr/bin/env node
// Upload a built release to the Cloudflare R2 bucket that backs the auto-update
// feed. electron-builder's `generic` provider is download-only — it can't push —
// so after `bun run dist` we upload the artifacts here. R2 is S3-compatible, so
// we use the AWS SDK pointed at the R2 endpoint. Credentials live ONLY on the
// build machine (env vars below); nothing secret ships in the app.
//
// What the updater needs in the bucket (flat, at the publish `url` root):
//   latest-mac.yml         the feed electron-updater polls (must be fresh)
//   Hearth-<ver>-*.zip     the actual update payload (Squirrel.Mac)
//   *.zip.blockmap         enables delta downloads
//   *.dmg                  first-install download (optional for updates)
//
// Required env (set on the release machine / CI, never committed):
//   R2_ENDPOINT           https://<accountid>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID      R2 API token access key
//   R2_SECRET_ACCESS_KEY  R2 API token secret
//   R2_BUCKET             bucket name (its public URL must match build.publish.url)
// Optional:
//   R2_PREFIX             key prefix if the feed lives in a sub-path of the bucket
//
// Usage:  bun run publish:update         (run after `bun run dist`)

import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX = '' } = process.env
const missing = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !process.env[k])
if (missing.length) {
  console.error(`[publish] missing env: ${missing.join(', ')}`)
  console.error('[publish] set the R2 credentials on the build machine, then re-run.')
  process.exit(1)
}

// Only these extensions matter to the updater; skip the rest of release/ (the
// unpacked .app, builder-effective-config, etc.).
const WANT = /\.(ya?ml|zip|blockmap|dmg)$/i
const isFeed = (f) => /\.ya?ml$/i.test(f)
const files = readdirSync(releaseDir)
  .filter((f) => WANT.test(f))
  .filter((f) => !/^builder-(debug|effective-config)/.test(f)) // electron-builder dumps, not feed assets
  .filter((f) => statSync(join(releaseDir, f)).isFile())
  // Artifacts first, the feed (latest-mac.yml) LAST — by intent, not filename
  // luck (U23): a client that reads a fresh feed before its artifacts finished
  // uploading would 404 the download. readdirSync order only happened to work
  // because 'H' sorts before 'l'.
  .sort((a, b) => Number(isFeed(a)) - Number(isFeed(b)))

if (!files.length) {
  console.error(`[publish] nothing to upload in ${releaseDir} — run \`bun run dist\` first.`)
  process.exit(1)
}

const contentType = (name) =>
  /\.ya?ml$/i.test(name)
    ? 'text/yaml'
    : /\.dmg$/i.test(name)
      ? 'application/x-apple-diskimage'
      : 'application/octet-stream'

// The feed must never be cached stale; versioned artifacts are immutable.
const cacheControl = (name) =>
  /\.ya?ml$/i.test(name) ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable'

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log(`[publish] Hearth ${pkg.version} → ${R2_BUCKET}${R2_PREFIX ? '/' + R2_PREFIX : ''} (${files.length} files)`)

for (const name of files) {
  const Key = (R2_PREFIX ? R2_PREFIX.replace(/\/$/, '') + '/' : '') + basename(name)
  const Body = readFileSync(join(releaseDir, name))
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key,
      Body,
      ContentType: contentType(name),
      CacheControl: cacheControl(name),
    }),
  )
  console.log(`[publish]   ✓ ${Key} (${(Body.length / 1e6).toFixed(1)} MB)`)
}
console.log('[publish] done. Clients will see the update on their next check.')
