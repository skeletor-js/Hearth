// Scaffold a standalone micro-app from templates/micro-app into micro-apps/<name>.
// Mirrors Stella's create-workspace-app.mjs. A micro-app is its own Vite + React
// project with its own deps — isolated from Hearth, embedded later via iframe.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PLACEHOLDER_FILES = ['package.json', 'index.html', 'src/App.tsx']

export interface ScaffoldResult {
  name: string
  dir: string
}

export function scaffoldMicroApp(repoRoot: string, rawName: string): ScaffoldResult {
  const name = rawName.trim()
  if (!NAME_RE.test(name)) {
    throw new Error('Invalid app name. Use lowercase letters, numbers, "-" and "_".')
  }

  const templateDir = join(repoRoot, 'templates', 'micro-app')
  const appsDir = join(repoRoot, 'micro-apps')
  mkdirSync(appsDir, { recursive: true })

  const dest = join(appsDir, name)
  // Guard against path traversal even though NAME_RE is strict.
  if (!resolve(dest).startsWith(resolve(appsDir) + sep)) {
    throw new Error('Invalid app name.')
  }
  if (existsSync(dest)) throw new Error(`Already exists: ${dest}`)
  if (!existsSync(templateDir)) throw new Error(`Template missing: ${templateDir}`)

  cpSync(templateDir, dest, { recursive: true })

  for (const file of PLACEHOLDER_FILES) {
    const path = join(dest, file)
    if (!existsSync(path)) continue
    writeFileSync(path, readFileSync(path, 'utf-8').replaceAll('{{name}}', name), 'utf-8')
  }

  return { name, dir: dest }
}
