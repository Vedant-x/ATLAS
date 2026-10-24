// Lint: ESLint's recommended rules, with each folder's own globals (browser pages, Node scripts and
// tests, the service worker, the Cloudflare workers). `npm run lint`; CI runs it on every pull request.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/', 'dist/', 'node_modules/', 'android/', 'test-results/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['js/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['js/assistant/llm-worker.js'], languageOptions: { globals: { ...globals.worker } } },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
  { files: ['worker/**/*.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  { files: ['scripts/**/*.{js,mjs}', 'test/**/*.mjs', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  { files: ['scripts/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } },
  // Browser tests evaluate functions inside the page.
  { files: ['test/ui/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
