import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// Flat config (ESLint 9+). Type-aware linting is intentionally off: this repo is
// edited at runtime by an agent, and project-service type-checking on every lint
// would make agent edits slow to validate. `bun run typecheck` covers types.
export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'src/routeTree.gen.ts', 'micro-apps/**', 'templates/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed args/vars are the repo's "intentionally unused" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['electron/**/*.{ts,mjs}', 'scripts/**/*.mjs', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
