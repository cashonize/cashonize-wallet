# Dependencies

Cashonize keeps its dependencies few. Each one is supply-chain risk (code running in the
wallet's origin, a maintainer account that can be compromised), complexity to review on every
upgrade, and bundle size. Read this before adding a dependency, upgrading a pinned one, or
replacing one with code of our own.

## The stance

**A dependency has to earn its place.** When we only use a small part of a package, we write
that part ourselves, as we did for chota, the icon webfont, `@vueuse/core`, electron-store,
the QR code component and mainnet-js.

**Where code ships is decided by imports, not by the dependency list.** Vite bundles whatever
the code imports from either list, so moving a package to `devDependencies` only means
something when no runtime code imports it.

**Security-critical dependencies are pinned exactly** (see AGENTS.md, Dependency Pinning).
`pnpm-workspace.yaml` also holds the supply-chain settings: a minimum release age and an
allowlist for install scripts.

## Decisions

**gql.tada is used for types only.** Its runtime only turned each query back into the same
string. `graphql` in `src/chainGraphSchema.ts` is an identity function with gql.tada's typed
signature, so gql.tada is a dev dependency. This rules out fragments, which need the runtime.

**Plausible is a single `fetch`, not Plausible's tracker.** The app sends one pageview per
load; the tracker also sent engagement events and exposed `window.plausible` to any script on
the page. Our sender strips the URL to origin and path, since a `?uri=` deep link can hold a
private key. Time on page and scroll depth are no longer reported.

**qr-scanner is pinned exactly.** It is unmaintained but works for what we scan and has no
known advisories; the pin guards against a hostile publish, and vendoring would freeze nothing
more. Its decoder struggles with very dense codes
(nimiq/qr-scanner#239).

**`@noble/hashes` and `@noble/ciphers` are direct dependencies for BIP38** (scrypt and
AES-ECB), which neither WebCrypto nor libauth provides.

## Accepted duplicates

**The graph holds several versions of the noble and scure crypto libraries, and pnpm cannot
merge them**, because every consumer pins an exact version. WalletConnect is on noble 1.x and
nostr-tools (through WizardConnect) on 2.x, which removed APIs WalletConnect uses, so forcing
one major breaks the other. `@walletconnect/relay-auth` also bundles its own copy of noble's
ed25519, out of any override's reach.

**Within a major we override only `@noble/curves` 1.x**, to the 1.9.7 that `@walletconnect/utils`
already uses: it moves only `ox`, whose curves code serves sign-in verification a Bitcoin Cash
wallet never runs. The 2.x copies under nostr-tools stay, since overriding them would put
newer crypto under code tested against older versions, for little gain. The fix is upstream: when `@walletconnect/utils` and
`relay-auth` move to noble 2.x, upgrade walletkit, core and the `overrides` block together.
Versions matter, not just duplication: `@noble/curves` 2.3.0 hardened its constant-time code,
including X25519 against a remote timing attack (fingerprinting, not key recovery), and the
copies WalletConnect and nostr-tools pin get it only from an upstream release.

## Protocol libraries

The dApp protocols bring most of the tree, each for its own reasons:

- **WalletConnect** is the largest part of the bundle, and roughly a third of it is code a Bitcoin
  Cash wallet never runs: EVM signature recovery and transaction-hash helpers for other chains.
  `@walletconnect/pay`, a large WebAssembly payments module walletkit only probes for, is removed
  by an override and a Vite stub. Leaner setups (`sign-client` without walletkit) save little,
  so trimming the rest is an upstream ask.
- **CashConnect** depends only on libauth and zod, which the app already ships, and brings its own
  small Nostr layer.
- **WizardConnect** brings nostr-tools with its own noble and scure copies, needed for Nostr's
  encryption and signatures. Some of its declared dependencies (`lossless-json`, `ws`) never
  ship.

## Candidates for later

- **WalletConnect on noble 2.x**, as above: check `npm view @walletconnect/utils dependencies`
  before upgrading walletkit.
- **qr-scanner**, if dense codes such as long pairing URIs fail in practice:
  `barcode-detector/ponyfill` (ZXing in WebAssembly, actively maintained), whose ~1 MB of
  WebAssembly the app must serve itself rather than from its default CDN. The browser's
  `BarcodeDetector` alone won't do, as several platforms lack it.
- **Dev tooling that doesn't ship**: `vite-plugin-checker` (duplicates the `vue-tsc` CI check)
  and `rollup-plugin-visualizer`.
- **A schema check for the Chaingraph queries**: an unknown field only shows in the editor. A
  vitest validating them with graphql-js (installed through gql.tada) against a committed
  schema file would catch it in CI.
