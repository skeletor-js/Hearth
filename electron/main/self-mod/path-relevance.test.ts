import { test, expect, describe } from 'bun:test'
import { classifyPath, classifyBatch, isViteTrackablePath, type ReloadKind } from './path-relevance'

describe('classifyPath', () => {
  const cases: Array<[string, ReloadKind]> = [
    // renderer components hot-swap
    ['src/app/chat/ChatApp.tsx', 'hmr'],
    ['src/shell/Sidebar.tsx', 'hmr'],
    ['src/styles/index.css', 'hmr'],

    // route files regenerate the route tree -> full reload
    ['src/routes/chat.tsx', 'full-reload'],
    ['src/routes/__root.tsx', 'full-reload'],
    ['src/routeTree.gen.ts', 'full-reload'],
    ['index.html', 'full-reload'],

    // main process -> restart
    ['electron/main/index.ts', 'process-restart'],
    ['electron/main/agents/claude.ts', 'process-restart'],

    // preload -> restart
    ['electron/preload/index.ts', 'process-restart'],

    // config files -> restart
    ['electron.vite.config.ts', 'process-restart'],
    ['package.json', 'process-restart'],
    ['tsconfig.json', 'process-restart'],

    // docs / scripts / micro-apps -> hmr (no shell reload)
    ['docs/ARCHITECTURE.md', 'hmr'],
    ['scripts/create-micro-app.mjs', 'hmr'],
    ['micro-apps/demo/src/App.tsx', 'hmr'],

    // Windows-style backslash paths normalize the same way
    ['src\\routes\\chat.tsx', 'full-reload'],
    ['electron\\main\\index.ts', 'process-restart'],
  ]

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} => ${expected}`, () => {
      expect(classifyPath(input)).toBe(expected)
    })
  }

  // Edge: prefix-vs-file. 'src/routes' (no trailing slash) is not a route file;
  // it falls through to the generic src/ -> hmr bucket. Only 'src/routes/...' escalates.
  test("'src/routes' without trailing slash => hmr", () => {
    expect(classifyPath('src/routes')).toBe('hmr')
  })
  test("'src/routes/x.tsx' => full-reload", () => {
    expect(classifyPath('src/routes/x.tsx')).toBe('full-reload')
  })

  // Edge: preload must not be misclassified as hmr.
  test('preload is process-restart, not hmr', () => {
    expect(classifyPath('electron/preload/index.ts')).not.toBe('hmr')
    expect(classifyPath('electron/preload/index.ts')).toBe('process-restart')
  })
})

describe('classifyBatch (strongest wins)', () => {
  test('all hmr => hmr', () => {
    expect(classifyBatch(['src/app/chat/ChatApp.tsx', 'src/shell/Sidebar.tsx'])).toBe('hmr')
  })

  test('hmr + a route file => full-reload', () => {
    expect(classifyBatch(['src/shell/Sidebar.tsx', 'src/routes/chat.tsx'])).toBe('full-reload')
  })

  test('mix including an electron/main file => process-restart', () => {
    expect(
      classifyBatch(['src/shell/Sidebar.tsx', 'src/routes/chat.tsx', 'electron/main/index.ts']),
    ).toBe('process-restart')
  })

  test('process-restart wins regardless of order', () => {
    expect(classifyBatch(['electron/main/index.ts', 'src/routes/chat.tsx'])).toBe('process-restart')
  })

  test('empty array => hmr (documented default)', () => {
    expect(classifyBatch([])).toBe('hmr')
  })
})

describe('isViteTrackablePath', () => {
  const yes = ['src/app/chat/ChatApp.tsx', 'src/shell/Rail.tsx', 'src/styles/hearth.css', 'index.html']
  const no = ['electron/main/index.ts', 'electron/preload/index.ts', 'package.json', 'docs/x.md']
  for (const p of yes) test(`${p} → trackable`, () => expect(isViteTrackablePath(p)).toBe(true))
  for (const p of no) test(`${p} → not trackable`, () => expect(isViteTrackablePath(p)).toBe(false))
})
