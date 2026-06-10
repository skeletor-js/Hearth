import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error untyped .mjs module (scripts are plain node ESM)
import { routeImportsOf, missingRouteImports } from './check-route-tree.mjs'

const TREE = `// @ts-nocheck
import { Route as rootRouteImport } from './routes/__root'
import { Route as ChatRouteImport } from './routes/chat'
import { Route as MicroNameRouteImport } from './routes/micro.$name'
import { createFileRoute } from '@tanstack/react-router'
`

describe('routeImportsOf', () => {
  test('extracts route specifiers, ignores non-route imports', () => {
    expect(routeImportsOf(TREE)).toEqual(['routes/__root', 'routes/chat', 'routes/micro.$name'])
  })
})

describe('missingRouteImports', () => {
  let srcDir: string
  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), 'route-check-'))
    mkdirSync(join(srcDir, 'routes'))
    for (const f of ['__root.tsx', 'chat.tsx', 'micro.$name.tsx']) {
      writeFileSync(join(srcDir, 'routes', f), 'export const Route = {}\n')
    }
  })
  afterEach(() => rmSync(srcDir, { recursive: true, force: true }))

  test('tree matching the routes dir passes', () => {
    expect(missingRouteImports(TREE, srcDir)).toEqual([])
  })

  test('a route file deleted without regenerating fails with the missing path', () => {
    rmSync(join(srcDir, 'routes', 'chat.tsx'))
    expect(missingRouteImports(TREE, srcDir)).toEqual(['routes/chat'])
  })

  test('a .ts route file (no .tsx) still counts as present', () => {
    rmSync(join(srcDir, 'routes', 'chat.tsx'))
    writeFileSync(join(srcDir, 'routes', 'chat.ts'), 'export const Route = {}\n')
    expect(missingRouteImports(TREE, srcDir)).toEqual([])
  })

  test('an added route plus regenerated tree passes', () => {
    writeFileSync(join(srcDir, 'routes', 'about.tsx'), 'export const Route = {}\n')
    const regenerated = TREE + `import { Route as AboutRouteImport } from './routes/about'\n`
    expect(missingRouteImports(regenerated, srcDir)).toEqual([])
  })
})
