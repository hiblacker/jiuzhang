import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import ts from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  stylistic.configs.customize({ indent: 2, quotes: 'single', semi: false, jsx: false }),
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'curly': ['error', 'all'],
      'one-var': ['error', 'never'],
      'max-statements-per-line': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.vue'] } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['src/api/**/*.ts', 'src/features/**/api.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['pinia', 'vue'],
        patterns: ['**/stores/**', '**/app/**', '**/*.vue'],
      }],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: ts.parser, vueFeatures: { filter: false } } },
    rules: {
      'vue/component-name-in-template-casing': [
        'error',
        'PascalCase',
        { registeredComponentsOnly: true },
      ],
      'vue/max-attributes-per-line': ['error', { singleline: 3, multiline: 1 }],
      'vue/html-indent': ['error', 2],
      'vue/html-self-closing': [
        'error',
        { html: { void: 'always', normal: 'always', component: 'always' } },
      ],
    },
  },
]
