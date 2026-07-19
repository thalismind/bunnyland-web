import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const bunnylandPlugin = {
  rules: {
    'jsx-key': {
      meta: {
        messages: { missing: 'Mapped JSX elements must have a stable key.' },
        schema: [],
        type: 'problem',
      },
      create(context) {
        const jsxRoot = (body) => body.type === 'JSXElement' || body.type === 'JSXFragment'
          ? body
          : null;
        return {
          "CallExpression[callee.type='MemberExpression'][callee.property.name='map']"(node) {
            const callback = node.arguments[0];
            if (!callback || callback.type !== 'ArrowFunctionExpression') return;
            const root = jsxRoot(callback.body);
            if (!root) return;
            if (root.type === 'JSXFragment') {
              context.report({ node: root, messageId: 'missing' });
              return;
            }
            const keyed = root.openingElement.attributes.some((attribute) => (
              attribute.type === 'JSXAttribute' && attribute.name.name === 'key'
            ));
            if (!keyed) context.report({ node: root, messageId: 'missing' });
          },
        };
      },
    },
  },
};

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
    plugins: {
      bunnyland: bunnylandPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      'bunnyland/jsx-key': 'error',
      '@typescript-eslint/no-restricted-types': ['error', {
        types: {
          object: 'Use a named interface, a specific record, or unknown at external boundaries.',
        },
      }],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
