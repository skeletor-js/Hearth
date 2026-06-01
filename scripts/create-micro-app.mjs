#!/usr/bin/env node
// CLI wrapper around the scaffolder so you can create a micro-app without the
// running app: `bun run create-app <name>` (or `node scripts/create-micro-app.mjs <name>`).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = (process.argv[2] ?? '').trim()

if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
  console.error('Usage: create-micro-app <name>  (lowercase letters, numbers, - _)')
  process.exit(1)
}

const templateDir = join(repoRoot, 'templates', 'micro-app')
const appsDir = join(repoRoot, 'micro-apps')
mkdirSync(appsDir, { recursive: true })
const dest = join(appsDir, name)

if (!resolve(dest).startsWith(resolve(appsDir) + sep)) {
  console.error('Invalid app name.')
  process.exit(1)
}
if (existsSync(dest)) {
  console.error(`Already exists: ${dest}`)
  process.exit(1)
}

cpSync(templateDir, dest, { recursive: true })
for (const file of ['package.json', 'index.html', 'src/App.tsx']) {
  const path = join(dest, file)
  if (!existsSync(path)) continue
  writeFileSync(path, readFileSync(path, 'utf-8').replaceAll('{{name}}', name), 'utf-8')
}

console.log(`Created micro-app: micro-apps/${name}`)
console.log(`Next: cd micro-apps/${name} && bun install && bun dev`)
