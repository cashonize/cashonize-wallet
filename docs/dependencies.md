# Dependencies

Cashonize keeps its dependencies few. Every package is code that runs in the wallet's origin
with access to everything the wallet holds, a maintainer whose account can be compromised,
and an upgrade someone has to review. Read this before adding a dependency, upgrading a pinned
one, or replacing one with code of our own.

## The stance

**A dependency has to earn its place.** Before adding one, ask whether the platform already
does it (WebCrypto, `fetch`, `Intl`), whether a dependency we already have does it (libauth
covers most Bitcoin Cash primitives), and whether the part we need is small enough to write and
own. A few dozen lines we understand beat a package whose other features we never use but
still ship.

**Where code ships is decided by imports, not by the dependency list.** Vite bundles whatever
the code imports, from `dependencies` or `devDependencies` alike, and the Electron build leaves
`node_modules` out entirely. Moving a package to `devDependencies` only means something when
no runtime code imports it.

**Security-critical dependencies are pinned exactly**, in `package.json` and, where they also
appear transitively, graph-wide in the `overrides` block of `pnpm-workspace.yaml` (see
AGENTS.md, Dependency Pinning). `pnpm-workspace.yaml` also holds the supply-chain settings: a
two-day minimum release age, and an allowlist of the packages allowed to run install scripts
(today only `@parcel/watcher`).

## Decisions

**gql.tada is used for types only.** It types the Chaingraph queries from the committed
introspection, but its runtime only parsed each query into a GraphQL document for
`@0no-co/graphql.web` to print back into the same string, about 10 KB minified. `graphql` in
`src/chainGraphSchema.ts` is an identity function cast to gql.tada's typed signature, so a
document is its query string at runtime and gql.tada is a dev dependency. This rules out
fragments, which need the runtime.

**Plausible is a single `fetch`, not Plausible's tracker.** The app has one route and sends one
pageview per load. The tracker (6 KB) also patched `history.pushState`, listened for clicks,
submits and visibility changes to send engagement events, and exposed `window.plausible` to
any script on the page. `src/boot/plausible.ts` posts to the documented Events API with the
URL stripped to origin and path (a `?uri=` deep link can hold a private key) and the referrer
stripped to its origin. Time on page and scroll depth are no longer reported.

**qr-scanner is pinned exactly at 1.4.2.** It has had no release or maintainer activity since
November 2022, but it works for what we scan and has no known security advisories. Nothing new
will be published, so the exact pin only guards against a hostile publish. Vendoring it would
freeze nothing more than the pin does. Its jsQR-based decoder struggles with very dense codes
(nimiq/qr-scanner#239).

**`@noble/hashes` and `@noble/ciphers` are direct dependencies for BIP38** (scrypt and
AES-ECB), which neither WebCrypto nor libauth provides.

## Accepted duplicates

The production graph holds several versions of the same crypto libraries:

| Library | Versions | Pinned by |
|---|---|---|
| `@noble/curves` | 1.8.0, 1.9.1, 1.9.7, 2.0.1 | `@walletconnect/relay-auth`, `ox`, `@walletconnect/utils`, `nostr-tools` |
| `@noble/hashes` | 1.7.0, 1.8.0, 2.0.1, 2.4.0 | the same, and the app (2.4.0) |
| `@noble/ciphers` | 1.3.0, 2.1.1, 2.4.0 | `@walletconnect/utils`, `nostr-tools`, the app |
| `@scure/bip32`, `@scure/bip39` | 1.x, 2.x | `ox` (tree-shaken out), `nostr-tools` |

**pnpm cannot merge them, because every consumer pins an exact version.** It deduplicates only
where declared ranges overlap, and here none do. WalletConnect is on the noble 1.x line and
nostr-tools (through WizardConnect) on 2.x; 2.x removed the import paths and APIs WalletConnect
uses, so forcing one major breaks the other. `@walletconnect/relay-auth` also bundles its own
copy of noble's ed25519 in its build, which no override can reach.

**We don't override them.** Merging within a major (curves 1.x to 1.9.7, hashes 2.x to 2.4.0,
and so on) saves about 14 KB gzipped, and a test gave byte-identical results, but it overrides
the crypto of a protocol library we don't control, which is the kind of change that has to be
deliberate. The real fix is upstream: when `@walletconnect/utils` and `relay-auth` move to
noble 2.x (through `ox` 1.x, already on noble 2.x), upgrade walletkit, core and the `overrides`
block together. Version matters here, not just duplication: `@noble/curves` 2.3.0 hardened
constant-time execution, including X25519, where a remote timing attack could learn about 4 bits
of a long-term key (fingerprinting, not key recovery). The 1.9.7 copy behind the WalletConnect
session key exchange lacks it, as does the 2.0.1 copy nostr-tools pins for WizardConnect for
its secp256k1 hardening; both get it only from an upstream release.

## Candidates for later

- **WalletConnect on noble 2.x**, as above, once a release exists: check
  `npm view @walletconnect/utils dependencies` before upgrading walletkit.
- **qr-scanner**, if dense codes such as long pairing URIs fail in practice:
  `barcode-detector/ponyfill` (ZXing compiled to WebAssembly, MIT, one dependency, actively
  maintained) is the strongest replacement. It costs about 1 MB of WebAssembly loaded only when
  the scanner opens, which has to be served by the app: by default it downloads it from a CDN.
  The browser's built-in `BarcodeDetector` can't replace it alone, as Windows and Linux
  desktop, Firefox and Safari don't have it.
- **Dev tooling** that doesn't ship: `vite-plugin-checker` (type errors in the dev overlay,
  while `vue-tsc` runs in CI) and `rollup-plugin-visualizer` (writes `dist/stats.html` on every
  build).
- **A schema check for the Chaingraph queries**: today an unknown field only shows in the
  editor. A vitest validating the three queries with graphql-js (already installed through
  gql.tada) against a committed schema file would catch it in CI.
