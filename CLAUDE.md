# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cashonize is a Bitcoin Cash (BCH) wallet supporting CashTokens, WalletConnect, CashConnect and WizardConnect. Built with Quasar Framework and TypeScript. Uses Vue 3 Composition API (`<script setup>`) and Pinia for state management. Targets multiple platforms: web (SPA), desktop (Electron), and mobile (Capacitor).

## Commands

Uses pnpm (v11). Config (overrides, supply-chain hardening, build-script allowlist) lives in `pnpm-workspace.yaml`.

```bash
pnpm dev                   # Start development server (opens browser)
pnpm build                 # Production build (generates dist/stats.html bundle analysis)
pnpm lint                  # ESLint check
pnpm test                  # Run vitest tests
pnpm check:i18n            # Locale files: duplicate keys, key parity, placeholders
pnpm exec vue-tsc --noEmit # Type check (Vue projects use vue-tsc, not plain tsc)
```

## Architecture

### View Navigation
Single-route SPA — views are switched via `store.displayView` in `WalletPage.vue`.

### State Management (Pinia Stores)
- **store.ts**: Main wallet state - `_wallet` (mutable ref), `wallet` (computed, throws if null), balance, UTXOs, token list, BCMR registries. Handles wallet initialization, network switching, transaction watching.
- **settingsStore.ts**: User preferences persisted to localStorage - currency, dark mode, electrum servers, per-wallet backup status, auto-approve settings for WalletConnect.
- **walletconnectStore.ts** / **cashconnectStore.ts**: dApp connection protocol handlers. Access the wallet via Pinia cross-store ref (`useStore()` inside `defineStore` setup).
- `_wallet` is a `shallowRef`: mainnet-js owns the wallet's internal state, so only swapping wallets is reactive, not changes inside the wallet object. Reactive code reading wallet internals depends on `walletUtxos` instead, which is why `store.walletHasAddress()` exists next to `store.wallet.hasAddress()`.
- Spending goes through `store.spend.*` rather than `store.wallet.*`, so mainnet-js's coin selection is always narrowed to `spendableUtxos`: the wallet's utxos minus the reserved outpoints, BCH and token coins alike (`utils/wallet/reservedUtxos.ts`). A reservation is local to this app; another wallet on the same keys can still spend the coin.
- **identitiesStore.ts**: the identities the wallet follows and everything resolved about them; reads the wallet and its coins from store.ts, which keeps the reservations that hold an authhead back.

### Multi-Wallet Support
- Wallets stored in IndexedDB via `@mainnet-cash/indexeddb-storage` (databases: "bitcoincash" for mainnet, "bchtest" for chipnet); by default each wallet is stored in both databases
- `activeWalletName` persisted in localStorage
- `utils/wallet/dbUtils.ts`: Direct IndexedDB operations for checking wallet existence, listing wallets, deletion

### Platform Concurrency
Only the web (SPA) target can run several live instances at once: browser tabs share localStorage and IndexedDB but nothing in memory (so a dApp request can raise dialogs in every open tab). There is no cross-tab sync: writes to a shared key re-read it first and change only their own entry, and reads trust the copy loaded at wallet activation, so another tab's writes stay invisible until reload. Electron and Android are single-instance by construction.

### Wallet Concurrency
Regardless of app instances, the same wallet can be live elsewhere (other devices, other wallet software), so on-chain state can change at any moment: in-memory UTXOs, balance and history are a cache, not a source of truth, and flows holding utxo state across user interaction must tolerate it going stale.

### mainnet-js (Core Wallet Library)

The wallet functionality is powered by `mainnet-js` v3, built on `@bitauth/libauth` for cryptographic primitives and transaction building, and `@electrum-cash/network` for blockchain data fetching from Electrum servers.

- Single-address wallets: `Wallet` for mainnet, `TestNetWallet` for chipnet
- HD wallets: `HDWallet` for mainnet, `TestNetHDWallet` for chipnet; address/key management goes through a `walletCache`
- The wallet type (`WalletType`) is a union of all four classes
- `settingsStore.getWalletType(walletName)` returns `'hd'` or `'single'` to distinguish wallet types
- Named wallets persist to IndexedDB (see Multi-Wallet Support)
- mainnet-js builds every ordinary send: coin selection, fees and change outputs are its call, not the app's. Dapp-supplied transactions are the exception: a shortcoming of the WalletConnect/WizardConnect protocols is that the dapp builds the transaction and the wallet only signs it, against libauth directly in `utils/dapp/wcSigning.ts` / `wizSigning.ts`.
- The app overrides several mainnet-js defaults. Those in `store.ts` must be applied before the first wallet is constructed, since HD wallets start address discovery during construction; the rest follow a user action instead.
- Docs: https://mainnet.cash/tutorial/

### Other Key Dependencies
- **@bitauth/libauth**: Cryptographic primitives, transaction encoding (https://libauth.org/)
- **@electrum-cash/network**: Electrum client used under mainnet-js (https://gitlab.com/electrum-cash/network)
- **@reown/walletkit**: WalletConnect integration (wraps @walletconnect/* packages). Uses BCH-specific payloads per the WC2-BCH spec: https://github.com/mainnet-pat/wc2-bch-bcr
- **@cashconnect-js/core** & **@cashconnect-js/nostr**: CashConnect protocol for BCH-native dApp connections. Docs: https://cashconnect.developers.cash/ — Repo: https://gitlab.com/cashconnect-js/cashconnect-js
- **@wizardconnect/core** & **@wizardconnect/wallet**: WizardConnect protocol for BCH HD-wallet dApp connections. Repo: https://gitlab.com/riftenlabs/lib/wizardconnect

### Persistent Storage
- **IndexedDB** belongs to the libraries: mainnet-js keeps wallet key material there (see Multi-Wallet Support) along with its electrum-history and HD-address caches, and WalletConnect keeps its session state there.
- **localStorage** holds everything the app persists itself: all settings (one key each), the active wallet name and network, per-wallet-per-network private data (transaction notes, address marks and labels, reserved outpoints, flipstarter pledges, identity categories and the ones dismissed from them, WizardConnect session URIs), and a TTL cache of fetched metadata (`cachedFetch`).

### Direct IndexedDB Access
The app reaches into mainnet-js's databases itself, in `utils/wallet/dbUtils.ts` and the settings menu's cache-size/clear and delete flows. Some of that goes through mainnet-js's own storage provider, the rest is raw IndexedDB where not even that reaches. There we have to keep matching its versions, store names and key formats, and mistakes fail silently: opening a database that does not exist yet creates it, and mainnet-js finding it already there never runs its own setup.

### Electrum Connections
mainnet-js configures `@electrum-cash/web-socket` to keep connections alive across visibility changes (tab switches, app backgrounding, window minimizing) rather than disconnecting/reconnecting. This matters because wallet subscriptions (balance watches, token monitors) are fire-and-forget callbacks via `runAsyncVoid`, so forcibly rejected electrum requests would surface as uncaught promise errors.

***Note:*** some environments (e.g. Safari, iOS) aggressively kill idle WebSocket connections in backgrounded tabs, which may cause stale connections when returning — mainnet-js handles reconnection on actual connection failures separately.

### Electrum Trust Model
Blockchain data comes from one electrum server at a time and is not verified. `@electrum-cash/network` is a single-server client with no cluster or SPV support, so balance, history, confirmations and block height are that server's claims rather than anything the wallet checks, and they are cached to IndexedDB.

### Chaingraph
Chaingraph is a secondary blockchain indexer next to electrum, a GraphQL (Hasura) service that allows arbitrary queries. Spending and balances run on electrum alone, but Chaingraph is not only cosmetic: one walk of the wallet's spent outputs feeds the portfolio's TapSwap and hodl discovery and the automatic detection of identities these keys made, which decides what gets held back from coin selection. It also resolves a token's authhead. The few queries live in `src/queryChainGraph.ts`, sent with plain fetch and typed from the schema with gql.tada rather than by hand (`src/chainGraphSchema.ts`, over a committed introspection in `src/generated/`). The Chaingraph setting is one URL for both networks: the instances in use index mainnet and chipnet behind one endpoint, and the identity queries are keyed by transaction hash, which is unambiguous across chains; an address-keyed query would mix chains and needs gating, as the spent-outputs walk is (mainnet only).

### Configurable Backends
Every backend the app talks to is one user-swappable server: electrum (per network), the Chaingraph instance, the BCMR and Cauldron indexers, the IPFS gateway and the exchange rate provider all live in settingsStore, selectable in the advanced settings from predefined choices plus, for most, a custom URL.

### CashConnect Transport
CashConnect communicates over a Nostr relay (default `wss://nostr.infra.cash`). The relay is store-and-forward with per-message TTLs, so dApp and wallet don't need to be online at the same time — a session survives either side going offline (short-lived messages like balance pushes simply expire rather than being replayed). Sessions persist in localStorage, namespaced per wallet identity key, and are restored by the library's `start()`; the app's `cashconnectStore.stop()` stops the service without un-pairing.

### WizardConnect
WizardConnect connects HD wallets to dApps over Nostr relays (`wiz:` URIs); the transport is fully encapsulated in @wizardconnect/core, so no separate nostr dependencies are needed. The wallet shares chain-level xpubs (receive/change/defi) so dapps derive addresses locally; the only interactive request is transaction signing, which MUST use `SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID` (see `wizSigning.ts`). HD wallets only; single-address wallets get a clear error on pairing.

### Token Metadata (BCMR)
BCMR (Bitcoin Cash Metadata Registries) is the metadata standard for authchain identities on BCH, tokens being the common case; the rest is under Authchain Identities. Spec: https://github.com/bitjson/chip-bcmr

Cashonize fetches token metadata from the Paytaca BCMR indexer (https://github.com/paytaca/bcmr-indexer) rather than importing full BCMR registry files. The `fetchTokenMetadata` function in `storeUtils.ts` handles this, and the codebase operates on the indexer's response types (`BcmrTokenMetadata`) directly, not full BCMR `Registry` objects. Like blockchain data (see Electrum Trust Model), token metadata is trusted as served: the token displays do not resolve or verify on-chain registries themselves. The indexer indexes token identities only (its identity records root at a token genesis and every route is keyed by category), so a BCH-only identity never enters it; the identities page resolves and verifies any identity's registry from its own publication instead, see Authchain Identities. The setting is therefore the "token metadata indexer" (`tokenMetadataIndexer` in code, with the old `bcmrIndexer*` localStorage keys kept as they are).

### Parsable NFTs
When the indexer returns `nft_type: "parsable"` with `token.nfts` parse info (bytecode, types, fields), the wallet runs the parsing bytecode locally in a libauth VM to extract and display structured data from NFT commitments.

Key files:
- `src/parsing/nftParsing.ts`: VM-based commitment parsing engine (`NftParseInfo` interface, `parseNft` function)
- `src/parsing/bcmr-v2.schema.ts`: TypeScript types for the BCMR v2 spec

### BCMR Extensions
BCMR identities can declare `extensions` — named plugins that modify a UTXO before NFT parsing. Extensions are registered in `src/parsing/extensions/index.ts` and invoked by the store's `parseNftCommitment` method. The main extension is ParyonUSD (`paryonusd.ts`), which fetches the live on-chain loan state for loan-key NFTs.

### Authchain Identities
A BCMR identity is an authchain: the lineage of output 0 starting at the authbase, whose latest transaction is the authhead. The authhead's unspent output 0 is the identity's UTXO, so holding that coin is holding the identity, and moving it is the whole of transfer and key rotation. Metadata binds to the identity through `BCMR` publication outputs on the chain, each committing to a hash of a registry file hosted off-chain; the wallet reads the last publication on the chain, since transfers and reserve moves carry none. The spec's identities are not only tokens - they also cover people, organizations and contract systems - and the token-specific parts of the wallet's handling are the reserve and the naming through the token metadata indexer.

The wallet's role is creation, custody, verification and publishing the pointer: making the identity (a token genesis, or any UTXO at output 0 for one that is not a token, prepared with a self-send if none suits), holding identity UTXOs and AuthKeys back from coin selection, fetching what the published locations serve and hashing it against the chain, and building the publication, reserve, mint and transfer transactions (all one shape, the old identity UTXO in and the new one at output 0). Authoring and hosting stay external (`utils/tools/authchainIdentity.ts`).

Resolution is forward only: authbase to authhead, one Chaingraph query. The wallet never derives an authbase from a coin, since every transaction is an authbase and backward has no answer; a coin is named by a token on its chain, by a registry its chain published (verified by hash, each named authbase resolved forward), or by the user, and is held back unnamed until then. How identities reach the page, what is trusted and what is verified, and what is spec versus Studio convention: `docs/bcmr-identities.md`.

An identity can instead keep its authhead in an AuthGuard covenant, with the authority to spend it tokenized as an "AuthKey" NFT (the AuthGuard standard, which CashTokens Studio implements). The covenant's script follows from the key's category, so a guarded identity is recognised at resolve by comparing the authhead's locking bytecode with the covenant derived from the identity's own category, the standard's genesis setup, or from the key the registry names in `extensions.authNft` (`utils/tools/authGuard.ts`); the key is any NFT of that category with no amount and no capability, protected the way an identity UTXO is. The covenant's own spends belong to the tools that build them.

### Cauldron DEX
Fungible token values come from the indexer of Cauldron, the main AMM DEX in the CashTokens ecosystem (`utils/defi/cauldronApi.ts`, one per network). The portfolio view always uses Cauldron prices; for the token list they are optional (the `showCauldronFTValue` setting).

### Portfolio Integrations
The portfolio view (`components/portfolio/`) charts the wallet's total value across held assets plus DeFi positions: Cauldron pools, Badgers.cash locks, Emerald DAO keycards, ParyonUSD loans and staking, TapSwap listings, and hodl timelocks. It is valuation only; acting on a position belongs in the dApps. For now every dapp needs its own custom integration: a `utils/defi/` module paired with a row component. How positions are found and valued differs per protocol (electrum contract lookups, data on held NFTs, or a Chaingraph walk of the wallet's spent outputs for OP_RETURN protocol markers) and is documented in each module's header comment.

### Wallet Tools
The settings menu carries tools that take Cashonize beyond a minimal wallet, from message signing to flipstarter pledging (components in `settings/`, logic in `utils/tools/`). Newer tools track a utxo's lifecycle: a flipstarter pledge reserves its coin and keeps its data keyed by outpoint for as long as the wallet holds the coin, and the identities page reserves a token identity's authhead, re-resolving which outpoint that is on every visit because the coin moves whenever the metadata is updated elsewhere. Automatic detection is the one path that reserves what the user never listed, reading the wallet's own chain history for identities these keys made; removing one is remembered so it is not listed again.

### Component Organization
```
src/components/
├── bchWallet.vue, myTokens.vue, connectDapp.vue, settingsMenu.vue  # Main tab views
├── walletOnboarding.vue                                             # Initial setup
├── settings/          # Components accessed from settings menu
├── walletconnect/     # WC2 session and dialog components (WC2TransactionRequest is shared with wizardconnect)
├── cashconnect/       # CC session and dialog components
├── wizardconnect/     # WizardConnect session components (sign dialogs are opened from wizardconnectStore)
├── history/           # Transaction history components
├── portfolio/         # Portfolio view (chart of total wallet value)
├── tokenItems/        # Token display components (FT, NFT)
├── qr/                # QR scanning components
└── general/           # Reusable components (alertDialog, seedPhraseInput, TokenIcon, ...)
```

`src/utils/` is grouped into subfolders the same way (`dapp/`, `defi/`, `wallet/`, ...).

### Validation
Zod schemas in `utils/zodValidation.ts` validate external data (WalletConnect params, API responses, BCMR data).

### Quasar Framework
Docs: https://quasar.dev/docs

- **Boot files** (`src/boot/`): Run at app startup - `icons.ts`, `i18n.ts`, `qrCodeComponent.ts`, `deepLinking.ts` (Capacitor only), `plausible.ts` (SPA production only)
- **Plugins**: `Notify` for toasts, `Dialog` for confirmations and custom dialogs (configured in quasar.config.ts)
- **Mode/env detection**: In app code, use Quasar v3 `import.meta.env.QUASAR_*` constants, e.g. `import.meta.env.QUASAR_SPA_MODE`.
- **Capacitor devDependencies**: Capacitor packages are in root `devDependencies` for typechecking; the runtime copies live in `src-capacitor/`

### Styling
Base CSS from a vendored subset of chota (`src/css/chota-subset.css`), custom styles in `src/css/`. Material icon names are mapped to SVG constants in `src/boot/icons.ts`; Quasar components use the `svg-material-icons` icon set, with no icon webfont.

Component styles are plain CSS by default; a few use `<style scoped lang="scss">` where variables or a mixin avoid repeating a block (sass is available through Quasar).

### Internationalization (i18n)
Uses `vue-i18n`. In Vue components use `useI18n()` composable; in utility files use `i18n.global` from `src/boot/i18n.ts`.

## Testing

Unit tests (`/test`, vitest) and E2E tests (`/test/e2e`, Playwright). IndexedDB-backed code (wallet storage) is unit-testable against `fake-indexeddb`. See `development.md` for full setup details.

## Dependency Pinning

Security-critical dependencies (key material, signing, dApp communication: mainnet-js, libauth, walletkit, @walletconnect/core, indexeddb-storage, cashconnect, wizardconnect) use exact versions in `package.json`; the ones that also appear as transitive deps are pinned graph-wide in the pnpm `overrides` block. Upgrades to these must be deliberate and reviewed — bump both places together.

A pinned dep may carry a pnpm patch, declared with its reason in `pnpm-workspace.yaml` and dropped once the fix lands upstream. mainnet-js has one: `tokenMint` and `tokenBurn` ignored the `utxoIds` option when picking their token inputs, which the wallet needs them to honor.

## Code Style Preferences

This is a crypto wallet - a security-sensitive environment where being overly careful is preferred over under-careful.

- **Check related files first**: Look for existing patterns before implementing - avoid duplication or accidentally deviating from established conventions
- **Prefer minimalism**: Choose simple, low-complexity solutions; when unsure about complexity, step back and consider carefully
- **Practical security focus**: Address real security concerns, don't get lost in theoretical edge cases
- **Meaningful tests**: Write tests that actually catch issues, not testing theatre
- **Readable over clever**: Prefer simple variable assignment + conditional override over ternaries for complex logic
- **Question necessity**: If something seems unnecessary, it probably is - ask before adding
