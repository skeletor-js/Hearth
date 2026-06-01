#!/usr/bin/env node
// Capture a PNG of the live, running Hearth window so an agent can visually
// inspect its own UI work. Hearth's main process serves the rendered frame at a
// loopback URL (see electron/main/snapshot.ts); this fetches it and saves a PNG.
//
//   node scripts/view-app.mjs                  -> capture the current view
//   node scripts/view-app.mjs /history         -> route to /history first, then capture
//   node scripts/view-app.mjs /history out.png -> ...and write to out.png
//
// A leading-slash first arg is treated as a route to navigate to; otherwise it's
// the output path. Then open/read the PNG. Requires Hearth running (`bun dev`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const urlFile = join(repoRoot, '.hearth', 'snapshot-url')

if (!existsSync(urlFile)) {
  console.error('Hearth does not appear to be running (no .hearth/snapshot-url). Start it with `bun dev`.')
  process.exit(1)
}

const args = process.argv.slice(2)
const path = args[0]?.startsWith('/') ? args.shift() : undefined
const base = readFileSync(urlFile, 'utf-8').trim()
const url = path ? `${base}?path=${encodeURIComponent(path)}` : base
const out = resolve(args[0] ?? join(repoRoot, '.hearth', 'snapshot.png'))

try {
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Snapshot request failed: HTTP ${res.status}`)
    process.exit(1)
  }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  console.log(out)
} catch (err) {
  console.error(`Could not reach Hearth's snapshot endpoint at ${url}: ${err.message}`)
  process.exit(1)
}
