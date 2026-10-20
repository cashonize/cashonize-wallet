# Cashonize

Cashonize: a Bitcoin Cash Wallet

## Install the dependencies
```bash
pnpm install
```

Uses [pnpm](https://pnpm.io/) (v11). If pnpm isn't installed, enable it via Corepack: `corepack enable pnpm`.

## Update the dependencies
```bash
pnpm update --interactive --latest
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
pnpm dev
# or
pnpm exec quasar dev
```

### Lint the files
```bash
pnpm lint
```

### Build the app for production
```bash
pnpm build
# or
pnpm exec quasar build
```

you should see a generated `dist/stats.html` file which is the output of the `rollup-plugin-visualizer`

The build command accepts a `-m` flag to target different platforms:
```bash
pnpm exec quasar build -m electron          # desktop (Electron)
pnpm exec quasar build -m capacitor -T android  # mobile (Capacitor Android)
```

Similarly for development:
```bash
pnpm exec quasar dev -m electron
pnpm exec quasar dev -m capacitor -T android
```

### Releasing a new version

The version number must be updated in three places:
1. `package.json` (root)
2. `src-capacitor/package.json`
3. `src-capacitor/android/app/build.gradle` (`versionName` and `versionCode`)

### Optionally Install the Quasar CLI
[See the Quasar CLI instructions](https://quasar.dev/start/quick-start#optional-install-the-global-cli)
```bash
pnpm add -g @quasar/cli
```

### Run unit tests

Unit testing is done with [Vitest](https://vitest.dev/). Vitest is configured in `vitest.config.ts`.

```bash
pnpm test
```

`pnpm test:coverage` runs them once with v8 coverage of the TypeScript in `src/` (not the `.vue` components): a summary in the terminal and an HTML report in `coverage/lcov-report/`. CI runs it too. Read it as a signal of what is untested, not a target; there are no thresholds.

### Refresh the Chaingraph schema

The Chaingraph queries are typed from a committed introspection (`src/generated/graphql-env.d.ts`). When the instance's schema changes, regenerate it from the URL in `tsconfig.json`:

```bash
pnpm generate:chaingraph
```

### Run E2E tests

E2E testing is done with [Playwright](https://playwright.dev/). Playwright is configured in `test/e2e/playwright.config.ts`.

When you run these tests for the first time, you'll need to download the Playwright browser binaries:

```bash
pnpm exec playwright install
```

Then you can run the tests:

```bash
# headless mode:
pnpm test:e2e

# or with the Playwright UI (interactive mode):
pnpm test:e2e:ui
```

If you already have the Cashonize dev server running (on port 9000) Playwright will test against that. Otherwise it will launch the dev server automatically before running tests.

There is a test dapp for WalletConnect E2E tests in `test/e2e/test-dapp` with its own [README](test/e2e/test-dapp/README.md). If you already have it running (on port 5188) Playwright will use that. Otherwise it will launch the dev server for that app automatically before running tests.

### Run the regtest E2E tests

`pnpm test:e2e:regtest` runs the app against a fresh local regtest chain instead of public chipnet, with no faucet or funded seed phrase needed. It needs local [BCHN](https://bitcoincashnode.org/) and [Fulcrum](https://github.com/cculianu/Fulcrum) binaries, at `~/BCH-infra/bchn/bin/bitcoind` and `~/BCH-infra/fulcrum/Fulcrum` or wherever `BITCOIND_PATH` and `FULCRUM_PATH` point, and `ss`, `curl` and `openssl`, which the start script and the per-run certificate use. Each run starts its chain in `~/BCH-infra/regtest-cashonize-e2e` (old runs stay until removed) and stops it afterwards.

The app runs in chipnet mode against that chain, through a proxy that maps its `bchtest:` addresses to the chain's `bchreg:` ones. The proxy runs as two instances, one over `ws://` and one over `wss://` with a self-signed certificate, so a test can switch the app between servers from the settings form, and it reports what each instance saw. The tests fund the wallet from coinbases mined to a test key and mine blocks as they need them.

The suite tests what a user does with the wallet; how transactions are built (coin selection, change, fees, token conservation) is tested in the library. `test/e2e/regtest/knownFailing.test.ts` holds known bugs as tests of the right behavior marked `test.fail()`: they keep the suite green, and one that starts passing fails the run until its `test.fail()` is removed and it moves to `regressions.test.ts`, which holds the bugs fixed since.

### Customize the configuration
See [The quasar.config file](https://quasar.dev/quasar-cli-vite/quasar-config-file).
