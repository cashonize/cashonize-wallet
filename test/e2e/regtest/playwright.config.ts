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
    // the proxy's wss:// instance has a self-signed certificate, as a local Fulcrum often has. This
    // covers the whole browser context, so no https certificate is checked in this suite.
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: 'pnpm dev',
    cwd: '../../..',
    port: 9000,
    reuseExistingServer: true,
  },
})
