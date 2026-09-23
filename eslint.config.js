const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'public/vendor/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$' }] },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // Defined by the vendored swagger-ui-bundle.js / swagger-ui-standalone-preset.js <script> tags
    // loaded before this file in public/api-docs/index.html.
    files: ['public/api-docs/init.js'],
    languageOptions: { globals: { SwaggerUIBundle: 'readonly', SwaggerUIStandalonePreset: 'readonly' } },
  },
];
