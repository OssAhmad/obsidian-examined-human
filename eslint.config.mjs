import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['src/**/*.test.mjs'] },
  ...obsidianmd.configs.recommendedWithLocalesEn,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.mjs'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      // Examined Human and SQLite are intentional technical acronyms in user-facing text.
      'obsidianmd/ui/sentence-case': 'off',
    },
  },
]);
