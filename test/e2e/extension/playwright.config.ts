import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// The extension suite loads dist/bex-chrome, which `pnpm test:e2e:extension` builds first.
// It only needs the test dApp: the wallet page is an extension page, not the dev server.
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // on 127.0.0.1, which serves both test origins: http://localhost:5188 and http://127.0.0.1:5188
      command: 'pnpm install && pnpm dev --host 127.0.0.1',
      cwd: resolve(import.meta.dirname, '../test-dapp'),
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
