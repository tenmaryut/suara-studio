import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**']
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'tests/e2e/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.{ts,mjs}'
    ],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.ts', 'tests/unit/**/*.ts'],
    languageOptions: { globals: globals.browser }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
