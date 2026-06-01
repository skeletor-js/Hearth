#!/usr/bin/env node
// Capture a PNG of the live, running Hearth window so an agent can visually
// inspect its own UI work. Hearth's main process serves the rendered frame at a
// loopback URL (see electron/main/snapshot.ts); this fetches it and saves a PNG.
//
//   node scripts/view-app.mjs            -> writes .hearth/snapshot.png
//   node scripts/view-app.mjs out.png    -> writes the given path
//
// Then open/read the PNG to see the current app. Requires Hearth to be running
// (`bun dev`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const urlFile = join(repoRoot, '.hearth', 'snapshot-url')

if (!existsSync(urlFile)) {
  console.error('Hearth does not appear to be running (no .hearth/snapshot-url). Start it with `bun dev`.')
  process.exit(1)
}

const url = readFileSync(urlFile, 'utf-8').trim()
const out = resolve(process.argv[2] ?? join(repoRoot, '.hearth', 'snapshot.png'))

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
