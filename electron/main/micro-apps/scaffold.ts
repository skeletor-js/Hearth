// Scaffold a standalone micro-app from templates/micro-app into micro-apps/<name>.
// Mirrors Stella's create-workspace-app.mjs. A micro-app is its own Vite + React
// project with its own deps — isolated from Hearth, embedded later via iframe.
//
// Optionally start from a *starter*: a one-file variant under templates/starters/<id>
// that overlays the base template's src/App.tsx (so starters carry no boilerplate).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { assertAppName } from './validate.js'

const PLACEHOLDER_FILES = ['package.json', 'index.html', 'src/App.tsx']

export interface ScaffoldResult {
  name: string
  dir: string
}

export interface StarterInfo {
  id: string
  title: string
  description: string
}

function startersDir(repoRoot: string): string {
  return join(repoRoot, 'templates', 'starters')
}

/** The blank starter every gallery shows first — maps to the base template. */
export const BLANK_STARTER: StarterInfo = {
  id: '',
  title: 'Blank',
  description: 'An empty micro-app to build from scratch.',
}

/** List the available starters (blank first, then templates/starters/<id>). */
export function listStarters(repoRoot: string): StarterInfo[] {
  const dir = startersDir(repoRoot)
  if (!existsSync(dir)) return [BLANK_STARTER]
  const found = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'App.tsx')))
    .map((d) => {
      const meta = readStarterMeta(join(dir, d.name))
      return { id: d.name, title: meta.title || d.name, description: meta.description || '' }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
  return [BLANK_STARTER, ...found]
}

function readStarterMeta(dir: string): { title?: string; description?: string } {
  const path = join(dir, 'starter.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

export function scaffoldMicroApp(repoRoot: string, rawName: string, starter?: string): ScaffoldResult {
  const name = assertAppName(rawName)

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

  // Overlay a starter's App.tsx, if one was chosen. Validated by membership in the
  // discovered list (not by the raw string) so a bogus id can't escape the dir.
  if (starter) {
    const known = listStarters(repoRoot).some((s) => s.id === starter)
    if (!known) throw new Error(`Unknown starter: ${starter}`)
    const src = join(startersDir(repoRoot), starter, 'App.tsx')
    writeFileSync(join(dest, 'src', 'App.tsx'), readFileSync(src, 'utf-8'), 'utf-8')
  }

  return { name, dir: dest }
}
