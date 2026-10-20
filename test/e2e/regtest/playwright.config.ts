// The regtest e2e suite: the app in chipnet mode against a local regtest chain (see globalSetup.ts),
// run with `pnpm test:e2e:regtest`. One worker, as every test shares the one chain.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.test.ts',
  timeout: 120_000,
  workers: 1,
  globalSetup: './globalSetup.ts',
  use: {
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: 'pnpm dev',
    cwd: '../../..',
    port: 9000,
    // turns off the type checker's error overlay, see quasar.config.ts
    env: { E2E: 'true' },
    reuseExistingServer: true,
  },
})
