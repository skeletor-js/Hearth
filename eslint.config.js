import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

// Flat config (ESLint 9+). Type-aware linting is intentionally off: this repo is
// edited at runtime by an agent, and project-service type-checking on every lint
// would make agent edits slow to validate. `bun run typecheck` covers types.
export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', '.hearth/**', 'node_modules/**', 'src/routeTree.gen.ts', 'micro-apps/**', 'templates/**'],
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
    // Hooks correctness (U19): rules-of-hooks as an error; exhaustive-deps as a
    // warning — this codebase deliberately uses []-dep subscriptions that read
    // live state via getState() (stale-closure-safe), and those are judgment
    // calls, not violations to auto-fail on.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['electron/**/*.{ts,mjs}', 'scripts/**/*.mjs', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // CommonJS build hooks (electron-builder afterSign, etc.) run under Node and
    // use require(); they aren't part of the TS app.
    files: ['build/**/*.cjs'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
