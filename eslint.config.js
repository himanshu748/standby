import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'static/ui/dist/**', 'site/dist/**', 'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.forge/**', 'video/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@forge/*', '../adapters/*'], message: 'src/core stays pure.' }] }] },
  },
);
