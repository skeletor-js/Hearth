import { test, expect, describe } from 'bun:test'
import { isSourceMutatingShell } from './shell-guard'

describe('isSourceMutatingShell', () => {
  const blocked = [
    "sed -i '' 's/a/b/' src/shell/Rail.tsx",
    'echo "x" > src/app/Chat.tsx',
    'cat foo >> electron/main/index.ts',
    'tee src/styles/hearth.css',
    'cp /tmp/x.tsx src/app/x.tsx',
    'mv old.tsx src/app/new.tsx',
  ]
  for (const c of blocked) test(`blocks: ${c}`, () => expect(isSourceMutatingShell(c)).toBe(true))

  const allowed = [
    'cat src/app/Chat.tsx', // read
    'grep -r foo src/', // read
    'bun run typecheck',
    'bun test src/x.test.ts',
    'git status',
    'git diff src/app/Chat.tsx',
    'eslint src/',
    'echo "log" > /tmp/out.log', // not source
    'echo hi >> dist/bundle.js', // generated output, not source
    'ls src/',
  ]
  for (const c of allowed) test(`allows: ${c}`, () => expect(isSourceMutatingShell(c)).toBe(false))
})
