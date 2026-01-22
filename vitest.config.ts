import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'src': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    root: './test',
    exclude: ['browser/**', 'node_modules/**'],
  },
})