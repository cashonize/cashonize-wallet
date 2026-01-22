import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import vue from '@vitejs/plugin-vue';
import path from 'path';

/**
 * Vitest config for running browser tests using Playwright.
 *
 * Run with: yarn test:browser
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'src': path.resolve(__dirname, './src'),
      'components': path.resolve(__dirname, './src/components'),
      'stores': path.resolve(__dirname, './src/stores'),
      'utils': path.resolve(__dirname, './src/utils'),
    },
  },
  define: {
    // Define process.env for browser environment
    'process.env': JSON.stringify({
      MODE: 'spa',
      version: '0.6.0',
    }),
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
      ],
      headless: true,
      screenshotFailures: false,
    },
    include: ['browser/**/*.test.ts'],
    root: './test',
    setupFiles: ['./browser/setup.ts'],
    globals: true,
  },
});
