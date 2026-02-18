# Cashonize

Cashonize: a Bitcoin Cash Wallet

## Install the dependencies
```bash
yarn
# or
npm install
```

## Update the dependencies
```bash
yarn upgrade-interactive --latest
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
yarn quasar dev
# or
npx quasar dev
```

### Lint the files
```bash
yarn lint
# or
npm run lint
```

### Format the files
```bash
yarn format
# or
npm run format
```

### Build the app for production
```bash
yarn quasar build
# or
npx quasar build
```

you should see a generated `dist/stats.html` file which is the output of the `rollup-plugin-visualizer`

### Optionally Install the Quasar CLI
[See the Quasar CLI instructions](https://quasar.dev/start/quick-start#optional-install-the-global-cli)
```bash
yarn global add @quasar/cli
# or
npm i -g @quasar/cli
```

### Run unit tests

Unit testing is done with [Vitest](https://vitest.dev/). Vitest is configured in `vitest.config.ts`.

```bash
yarn test
```

### Run E2E tests

E2E testing is done with [Playwright](https://playwright.dev/). Playwright is configured in `test/e2e/playwright.config.ts`.

When you run these tests for the first time, you'll need to download the Playwright browser binaries:

```bash
yarn exec playwright install
```

Then you can run the tests:

```bash
# headless mode:
yarn test:e2e

# or with the Playwright UI (interactive mode):
yarn test:e2e:ui
```

If you already have the Cashonize dev server running (on port 9000) Playwright will test against that. Otherwise it will launch the dev server automatically before running tests.

There is a test dapp for WalletConnect E2E tests in `test/e2e/test-dapp` with its own [README](test/e2e/test-dapp/README.md). If you already have it running (on port 5188) Playwright will use that. Otherwise it will launch the dev server for that app automatically before running tests.

### Customize the configuration
See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-js).
