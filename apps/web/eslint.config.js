import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
export default ts.config(
  {
    ignores: [
      'dist/**',
      'dist-real/**',
      'public/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] },
      globals: Object.fromEntries(
        [
          'window',
          'document',
          'navigator',
          'localStorage',
          'location',
          'console',
          'URL',
          'Blob',
          'Request',
          'Response',
          'AbortSignal',
          'crypto',
          'setTimeout',
          'clearTimeout',
          'ResizeObserver',
          'MutationObserver',
          'getComputedStyle',
          'FileReader',
          'HTMLInputElement',
          'HTMLElement',
          'Event',
          'URLSearchParams',
          'structuredClone',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-nested-ternary': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.app.json',
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
        parser: ts.parser,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: false }],
    },
  },
  {
    files: ['src/pages/**/*.{ts,vue}', 'src/modules/**/*.{ts,vue}'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB'],
      'no-restricted-imports': ['error', { paths: ['axios', 'node-fetch', 'ofetch'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(fetch|localStorage|sessionStorage|indexedDB)$/]',
          message: 'Use the shared transport or preference adapter.',
        },
        {
          selector:
            'MemberExpression[object.name=/^(window|globalThis)$/][property.value=/^(fetch|localStorage|sessionStorage|indexedDB)$/]',
          message: 'Computed member access must use the shared adapter.',
        },
      ],
    },
  },
  prettier,
  // ESLint's core data-flow rule cannot see reads in Vue templates. The Vue-aware
  // unused-variable rule remains enabled for these files.
  { files: ['**/*.vue'], rules: { 'no-useless-assignment': 'off' } },
)
