// Flat ESLint configuration for the product console.
//
// Division of labour: Prettier owns formatting (eslint-config-prettier is applied last, so any
// layout rule set here would be switched off again - do not add formatting rules), ESLint owns
// correctness, size and layering. The size and boundary rules come from
// docs/47-frontend-architecture-plan.md; rules that the current sources cannot satisfy yet are
// enabled as warnings with a recorded baseline, and are flipped to errors as the migration
// phases land.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'licenses/**', 'dependency-review.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // Size and density: the values are the agreed limits (800 lines per file, 80 per function).
      'max-lines': ['error', { max: 800 }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],

      // Correctness.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Deferred to the migration phases, measured baseline recorded in docs/47 14.2. The
      // unsafe-* family and the template/base-to-string rules all come from the untyped API and
      // DTO layer, which P2 replaces with typed api/ modules; until then they stay warnings so
      // the gate stays honest instead of being switched off.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // Views are orchestration: logic belongs in a named handler or a composable, not inline.
      'vue/no-mutating-props': 'error',
      'vue/multi-word-component-names': 'off',
      // Vue 3 has no filters at all, so this rule can only fire on TypeScript union types that
      // appear inside bound attributes (for example ':value="x as string | number"').
      'vue/no-deprecated-filter': 'off',
    },
  },
  prettier,
);
