// Route-tree freshness gate (audit U2). The generated routeTree.gen.ts opens
// with @ts-nocheck, so tsc is blind to it importing a route file that no
// longer exists — the app then breaks at runtime with no failing gate. This
// check fails when any `./routes/*` import in the tree has no backing file.
//
// It runs as the first half of `bun run typecheck`, which is also what the
// self-mod post-edit validation gate (electron/main/self-mod/validate.ts)
// executes — so agent edits that delete a route without regenerating the
// tree are caught by the same gate, without touching the protected island.
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTE_IMPORT_RE = /from\s+['"]\.\/(routes\/[^'"]+)['"]/g

/** Route-file specifiers (e.g. "routes/chat") imported by the tree source. */
export function routeImportsOf(treeSource) {
  return [...treeSource.matchAll(ROUTE_IMPORT_RE)].map((m) => m[1])
}

/** Imports with no .tsx/.ts file on disk under srcDir. Empty array = fresh. */
export function missingRouteImports(treeSource, srcDir) {
  return routeImportsOf(treeSource).filter(
    (spec) => !existsSync(join(srcDir, `${spec}.tsx`)) && !existsSync(join(srcDir, `${spec}.ts`)),
  )
}

function main() {
  const srcDir = resolve(process.cwd(), 'src')
  const treePath = join(srcDir, 'routeTree.gen.ts')
  if (!existsSync(treePath)) {
    console.error('route-tree check: src/routeTree.gen.ts missing — run `bun run routes:gen`')
    process.exit(1)
  }
  const missing = missingRouteImports(readFileSync(treePath, 'utf8'), srcDir)
  if (missing.length > 0) {
    console.error(
      `route-tree check: routeTree.gen.ts imports ${missing.length} route file(s) that do not exist:\n` +
        missing.map((s) => `  src/${s}.tsx`).join('\n') +
        '\nRegenerate the tree (`bun run routes:gen`) or restore the route file.',
    )
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
