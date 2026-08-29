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
      // Keep display() for compatibility with minAppVersion 1.8.7; the declarative
      // settings API and searchable settings require Obsidian 1.13+.
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
      // Examined Human and SQLite are intentional technical acronyms in user-facing text.
      'obsidianmd/ui/sentence-case': 'off',
    },
  },
  {
    files: ['src/logger-bridge.ts'],
    rules: {
      // This module is loaded on every platform but evaluates Node imports only
      // after a Platform.isDesktopApp guard. Mobile dashboards never call it.
      'obsidianmd/no-nodejs-modules': 'off',
      // Obsidian's desktop plugin loader is CommonJS. A lazy require inside the
      // desktop guard avoids an eager mobile dependency and a broken browser-like
      // import("node:...") fetch in Electron.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
