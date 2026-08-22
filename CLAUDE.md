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
- Spending goes through `store.spend.*` rather than `store.wallet.*`, so mainnet-js's coin selection is always narrowed to the spendable pool; an ESLint rule enforces it.

### Multi-Wallet Support
- Wallets stored in IndexedDB via `@mainnet-cash/indexeddb-storage` (databases: "bitcoincash" for mainnet, "bchtest" for chipnet)
- `activeWalletName` persisted in localStorage
- `dbUtils.ts`: Direct IndexedDB operations for checking wallet existence, listing wallets, deletion
- Wallets are stored in both IndexedDB databases by default (mainnet and chipnet)

### Platform Concurrency
Only the web (SPA) target can run several live instances at once: browser tabs share localStorage and IndexedDB but nothing in memory (so a dApp request can raise dialogs in every open tab). There is no cross-tab sync: writes to a shared key re-read it first and change only their own entry, and reads trust the copy loaded at wallet activation, so another tab's writes stay invisible until reload. Electron and Android are single-instance by construction.

### Wallet Concurrency
Regardless of app instances, the same wallet can be live elsewhere (other devices, other wallet software), so on-chain state can change at any moment: in-memory UTXOs, balance and history are a cache, not a source of truth, and flows holding utxo state across user interaction must tolerate it going stale.

### mainnet-js (Core Wallet Library)

The wallet functionality is powered by `mainnet-js` v3, built on `@bitauth/libauth` for cryptographic primitives and transaction building, and `@electrum-cash/network` for blockchain data fetching from Electrum servers.

v3 introduced breaking changes including HD wallet support with new classes (`HDWallet`, `TestNetHDWallet`) and a `walletCache` for address/key management.

- Single-address wallets: `Wallet` for mainnet, `TestNetWallet` for chipnet
- HD wallets: `HDWallet` for mainnet, `TestNetHDWallet` for chipnet
- The wallet type (`WalletType`) is a union of all four classes
- `settingsStore.getWalletType(walletName)` returns `'hd'` or `'single'` to distinguish wallet types
- Named wallets persist to IndexedDB via `@mainnet-cash/indexeddb-storage`
- mainnet-js builds every ordinary send: coin selection, fees and change outputs are its call, not the app's. Dapp-supplied transactions are the exception, signed against libauth directly in `wcSigning.ts` / `wizSigning.ts`.
- The app overrides several mainnet-js defaults. Those in `store.ts` must be applied before the first wallet is constructed, since HD wallets start address discovery during construction; the rest follow a user action instead.
- Docs: https://mainnet.cash/tutorial/

### Other Key Dependencies
- **@bitauth/libauth**: Cryptographic primitives, transaction encoding (https://libauth.org/)
- **@electrum-cash/network**: Electrum client used under mainnet-js (https://gitlab.com/electrum-cash/network)
- **@reown/walletkit**: WalletConnect integration (wraps @walletconnect/* packages). Uses BCH-specific payloads per the WC2-BCH spec: https://github.com/mainnet-pat/wc2-bch-bcr
- **@cashconnect-js/core** & **@cashconnect-js/nostr**: CashConnect protocol for BCH-native dApp connections. Docs: https://cashconnect.developers.cash/ — Repo: https://gitlab.com/cashconnect-js/cashconnect-js
- **@wizardconnect/core** & **@wizardconnect/wallet**: WizardConnect protocol for BCH HD-wallet dApp connections. Repo: https://gitlab.com/riftenlabs/lib/wizardconnect

### Persistent Storage
- **IndexedDB** belongs to the libraries: mainnet-js keeps wallet key material there (via `@mainnet-cash/indexeddb-storage`, see Multi-Wallet Support) along with its electrum-history and HD-address caches, and WalletConnect keeps its session state there.
- **localStorage** holds everything the app persists itself: all settings (one key each), the active wallet name and network, per-wallet-per-network private data (transaction notes, address marks and labels, reserved outpoints, flipstarter pledges, WizardConnect session URIs), and a TTL cache of fetched metadata (`cachedFetch`).

### Direct IndexedDB Access
The app reaches into mainnet-js's databases itself, in `dbUtils.ts` and the settings menu's cache-size/clear and delete flows. Some of that goes through mainnet-js's own storage provider, the rest is raw IndexedDB where not even that reaches. There we have to keep matching its versions, store names and key formats, and mistakes fail silently: opening a database that does not exist yet creates it, and mainnet-js finding it already there never runs its own setup.

### Electrum Connections
mainnet-js configures `@electrum-cash/web-socket` to keep connections alive across visibility changes (tab switches, app backgrounding, window minimizing) rather than disconnecting/reconnecting. This matters because wallet subscriptions (balance watches, token monitors) are fire-and-forget callbacks via `runAsyncVoid`, so forcibly rejected electrum requests would surface as uncaught promise errors.

***Note:*** some environments (e.g. Safari, iOS) aggressively kill idle WebSocket connections in backgrounded tabs, which may cause stale connections when returning — mainnet-js handles reconnection on actual connection failures separately.

### Electrum Trust Model
Blockchain data comes from one electrum server at a time and is not verified. `@electrum-cash/network` is a single-server client with no cluster or SPV support, so balance, history, confirmations and block height are that server's claims rather than anything the wallet checks, and they are cached to IndexedDB.

### CashConnect Transport
CashConnect communicates over a Nostr relay (default `wss://nostr.infra.cash`). The relay is store-and-forward with per-message TTLs, so dApp and wallet don't need to be online at the same time — a session survives either side going offline (short-lived messages like balance pushes simply expire rather than being replayed). Sessions persist in localStorage, namespaced per wallet identity key, and are restored by the library's `start()`; the app's `cashconnectStore.stop()` stops the service without un-pairing.

### WizardConnect
WizardConnect connects HD wallets to dApps over Nostr relays (`wiz:` URIs); the transport is fully encapsulated in @wizardconnect/core, so no separate nostr dependencies are needed. The wallet shares chain-level xpubs (receive/change/defi) so dapps derive addresses locally; the only interactive request is transaction signing, which MUST use `SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID` (see `wizSigning.ts`). HD wallets only; single-address wallets get a clear error on pairing.

### Token Metadata (BCMR)
BCMR (Bitcoin Cash Metadata Registries) is the metadata standard for CashTokens on BCH. Spec: https://github.com/bitjson/chip-bcmr

Cashonize fetches token metadata from the Paytaca BCMR indexer (https://github.com/paytaca/bcmr-indexer) rather than importing full BCMR registry files. The `fetchTokenMetadata` function in `storeUtils.ts` handles this. The codebase operates on the indexer's response types (`BcmrTokenMetadata`) directly — it does not use or construct full BCMR `Registry` objects. Supporting full registries (e.g. from on-chain or imported files) would require a refactor to bridge between `Registry` and the current parsing/display code.

### Parsable NFTs
Cashonize is the first wallet to support parsable BCMR NFTs. When the indexer returns `nft_type: "parsable"` with `token.nfts` parse info (bytecode, types, fields), the wallet runs the parsing bytecode locally in a libauth VM to extract and display structured data from NFT commitments.

Key files:
- `src/parsing/nftParsing.ts`: VM-based commitment parsing engine (`NftParseInfo` interface, `parseNft` function)
- `src/parsing/bcmr-v2.schema.ts`: TypeScript types for the BCMR v2 spec

### BCMR Extensions
BCMR identities can declare `extensions` — named plugins that modify a UTXO before NFT parsing. Extensions are registered in `src/parsing/extensions/index.ts` and invoked by the store's `parseNftCommitment` method. The main extension is ParyonUSD (`paryonusd.ts`), which fetches the live on-chain loan state for loan-key NFTs.

### Cauldron DEX
Cauldron is the main AMM DEX in the CashTokens ecosystem; fungible token values come from its indexer (`utils/cauldronApi.ts`, one per network). The portfolio view always uses Cauldron prices; for the token list they are optional (the `showCauldronFTValue` setting). Pools the wallet owns are found over electrum instead (`utils/cauldronPools.ts`), by deriving the pool contract address from the wallet's public key hashes, including the `defi` chain shared over WizardConnect.

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

Unit tests (`/test`, vitest) and E2E tests (`/test/e2e`, Playwright). See `development.md` for full setup details.

## Dependency Pinning

Security-critical dependencies (key material, signing, dApp communication: mainnet-js, libauth, walletkit, @walletconnect/core, indexeddb-storage, cashconnect, wizardconnect) use exact versions in `package.json`; the ones that also appear as transitive deps are pinned graph-wide in the pnpm `overrides` block. Upgrades to these must be deliberate and reviewed — bump both places together.

## Code Style Preferences

This is a crypto wallet - a security-sensitive environment where being overly careful is preferred over under-careful.

- **Check related files first**: Look for existing patterns before implementing - avoid duplication or accidentally deviating from established conventions
- **Prefer minimalism**: Choose simple, low-complexity solutions; when unsure about complexity, step back and consider carefully
- **Practical security focus**: Address real security concerns, don't get lost in theoretical edge cases
- **Meaningful tests**: Write tests that actually catch issues, not testing theatre
- **Readable over clever**: Prefer simple variable assignment + conditional override over ternaries for complex logic
- **Question necessity**: If something seems unnecessary, it probably is - ask before adding
