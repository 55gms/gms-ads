import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const loaders = ['overview', 'campaigns', 'creatives', 'analytics', 'domains', 'members', 'sizes', 'keys', 'ingest', 'audit'].map((n) => `${n}Loader`);

export default [
  { ignores: ['web/dist', 'embed/dist', 'node_modules', 'web/public'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'shared/**/*.js', 'edge/**/*.js', 'scripts/**/*.js', '*.js', 'web/vite.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['embed/src/**/*.js'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'module', globals: globals.browser },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] },
  },
  {
    files: ['web/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Route modules export their loader next to the page component.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: loaders }],
      // Capitalised names are components passed as props (icon: Icon).
      'no-unused-vars': ['error', { argsIgnorePattern: '^(_|[A-Z])', varsIgnorePattern: '^[A-Z_]', caughtErrors: 'none' }],
    },
  },
];
