// Regenerate src/routeTree.gen.ts from src/routes/ without starting the dev
// server. The tree is gitignored (generated output), so a clean checkout has
// none until the TanStack vite plugin runs — CI needs it before typecheck,
// and the same generator keeps it identical to what dev/build would emit.
import { Generator, getConfig } from '@tanstack/router-generator'

const root = process.cwd()
const config = getConfig(
  // Mirror the plugin options in electron.vite.config.ts.
  { target: 'react', routesDirectory: 'src/routes', generatedRouteTree: 'src/routeTree.gen.ts' },
  root,
)
await new Generator({ config, root }).run()
console.log('route tree generated: src/routeTree.gen.ts')
