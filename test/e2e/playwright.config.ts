// This is a standalone Playwright test config invoked separate from the Vitest
// test suite. In the future the Playwright tests could be invoked by Vitest.

import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// Load .env from project root so E2E_SEED_PHRASE is available
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env'))
} catch {
  /* the variable might come from the parent environment or might not be set */
}

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  use: {
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: [
    {
      command: 'yarn dev',
      cwd: '../..',
      port: 9000,
      reuseExistingServer: true,
    },
    {
      command: 'yarn dev',
      cwd: './test-dapp',
      port: 5188,
      reuseExistingServer: true,
    }
  ],
})
