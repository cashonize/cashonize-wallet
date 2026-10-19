import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '#q-app': '@quasar/app-vite',
      'src': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', '**/node_modules/**'],
    setupFiles: ['./test/setup.ts'],
    // a signal of what the unit tests leave untested, not a target: no thresholds.
    // .ts only: there is no vue plugin here, and the unit tests do not render components
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
})
