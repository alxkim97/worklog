// A safety net, not a style guide: catches names used without being defined
// or imported (the v2.6.0 PV lots / Search crash) and imports that don't
// exist. Runs as part of `npm test`, and `npm run release` runs the tests.
import globals from 'globals'

export default [
  { ignores: ['node_modules/', 'dist/', 'release/', 'dev-dist/', '.shots/', 'cli-log/', 'backups/'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, __APP_VERSION__: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-undef': 'error' },
  },
]
