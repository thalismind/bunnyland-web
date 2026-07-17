import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  ...globals.browser,
  BunnylandApi: 'readonly',
  BunnylandPlay: 'readonly',
  BunnylandTrace: 'readonly',
  BunnylandUI: 'readonly',
  BunnylandWorld: 'readonly',
  LiteGraph: 'readonly',
  LGraph: 'readonly',
  LGraphCanvas: 'readonly',
  LGraphNode: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'artifacts/**',
      'dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.html'],
    plugins: { html },
  },
  {
    files: ['**/*.{js,html}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['eslint.config.js', 'test/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
