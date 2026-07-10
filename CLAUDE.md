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
pnpm exec vue-tsc --noEmit # Type check (Vue projects use vue-tsc, not plain tsc)
```

## Architecture

### View Navigation
Single-route SPA — views are switched via `store.displayView` in `WalletPage.vue`.

### State Management (Pinia Stores)
- **store.ts**: Main wallet state - `_wallet` (mutable ref), `wallet` (computed, throws if null), balance, UTXOs, token list, BCMR registries. Handles wallet initialization, network switching, transaction watching.
- **settingsStore.ts**: User preferences persisted to localStorage - currency, dark mode, electrum servers, per-wallet backup status, auto-approve settings for WalletConnect.
- **walletconnectStore.ts** / **cashconnectStore.ts**: dApp connection protocol handlers. Access the wallet via Pinia cross-store ref (`useStore()` inside `defineStore` setup).

### Multi-Wallet Support
- Wallets stored in IndexedDB via `@mainnet-cash/indexeddb-storage` (databases: "bitcoincash" for mainnet, "bchtest" for chipnet)
- `activeWalletName` persisted in localStorage
- `dbUtils.ts`: Direct IndexedDB operations for checking wallet existence, listing wallets, deletion
- Wallets are stored in both IndexedDB databases by default (mainnet and chipnet)

### Platform Concurrency
Only the web (SPA) target can run multiple live app instances at once: several browser tabs (or a PWA window plus a tab) share the same localStorage and IndexedDB, but each has its own in-memory Pinia state, electrum connections, and WalletKit instance. There is no cross-tab sync (no `storage` listener or `BroadcastChannel`), so code that persists mutable state must assume another tab can read or write the same keys concurrently and that in-memory state may be stale relative to storage. Electron is single-window by construction (one `createWindow`, all `window.open` denied in `electron-main.ts`) and the Android activity is `launchMode="singleTask"`, so desktop and mobile always have exactly one live instance.

### mainnet-js (Core Wallet Library)

The wallet functionality is powered by `mainnet-js` v3, built on `@bitauth/libauth` for cryptographic primitives and transaction building, and `@electrum-cash/network` for blockchain data fetching from Electrum servers.

v3 introduced breaking changes including HD wallet support with new classes (`HDWallet`, `TestNetHDWallet`) and a `walletCache` for address/key management.

- Single-address wallets: `Wallet` for mainnet, `TestNetWallet` for chipnet
- HD wallets: `HDWallet` for mainnet, `TestNetHDWallet` for chipnet
- The wallet type (`WalletType`) is a union of all four classes
- `settingsStore.getWalletType(walletName)` returns `'hd'` or `'single'` to distinguish wallet types
- Named wallets persist to IndexedDB via `@mainnet-cash/indexeddb-storage`
- The app overrides two mainnet-js global defaults: `Config.DefaultParentDerivationPath` (derivation path, in `walletUtils.ts`) and `DefaultProvider.servers` (electrum servers, in `store.ts`). The electrum override must be applied before any `WalletClass.named()`, since HD wallets start address discovery on the default provider during construction.
- Docs: https://mainnet.cash/tutorial/

### Other Key Dependencies
- **@bitauth/libauth**: Cryptographic primitives, transaction encoding (https://libauth.org/)
- **@electrum-cash/network**: Electrum client used under mainnet-js (https://gitlab.com/electrum-cash/network)
- **@reown/walletkit**: WalletConnect integration (wraps @walletconnect/* packages). Uses BCH-specific payloads per the WC2-BCH spec: https://github.com/mainnet-pat/wc2-bch-bcr
- **@cashconnect-js/core** & **@cashconnect-js/wallet**: CashConnect protocol for BCH-native dApp connections. Docs: https://cashconnect.developers.cash/ — Repo: https://gitlab.com/cashconnect-js/cashconnect-js
- **@wizardconnect/core** & **@wizardconnect/wallet**: WizardConnect protocol for BCH HD-wallet dApp connections over Nostr relays (`wiz:` URIs). The wallet shares chain-level xpubs (receive/change/defi) so dapps derive addresses locally; the only interactive request is transaction signing, which MUST use `SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID` (see `wizSigning.ts`). Nostr transport is fully encapsulated in @wizardconnect/core — no separate nostr deps. HD wallets only; single-address wallets get a clear error on pairing. Repo: https://gitlab.com/riftenlabs/lib/wizardconnect

### Electrum Connections
mainnet-js configures `@electrum-cash/web-socket` to keep connections alive across visibility changes (tab switches, app backgrounding, window minimizing) rather than disconnecting/reconnecting. This matters because wallet subscriptions (balance watches, token monitors) are fire-and-forget callbacks via `runAsyncVoid`, so forcibly rejected electrum requests would surface as uncaught promise errors.

***Note:*** some environments (e.g. Safari, iOS) aggressively kill idle WebSocket connections in backgrounded tabs, which may cause stale connections when returning — mainnet-js handles reconnection on actual connection failures separately.

### Token Metadata (BCMR)
BCMR (Bitcoin Cash Metadata Registries) is the metadata standard for CashTokens on BCH. Spec: https://github.com/bitjson/chip-bcmr

Cashonize fetches token metadata from the Paytaca BCMR indexer (https://github.com/paytaca/bcmr-indexer) rather than importing full BCMR registry files. The `fetchTokenMetadata` function in `storeUtils.ts` handles this. The codebase operates on the indexer's response types (`BcmrTokenMetadata`) directly — it does not use or construct full BCMR `Registry` objects. Supporting full registries (e.g. from on-chain or imported files) would require a refactor to bridge between `Registry` and the current parsing/display code.

### Parsable NFTs
Cashonize is the first wallet to support parsable BCMR NFTs. When the indexer returns `nft_type: "parsable"` with `token.nfts` parse info (bytecode, types, fields), the wallet runs the parsing bytecode locally in a libauth VM to extract and display structured data from NFT commitments.

Key files:
- `src/parsing/nftParsing.ts`: VM-based commitment parsing engine (`NftParseInfo` interface, `parseNft` function)
- `src/parsing/bcmr-v2.schema.ts`: TypeScript types for the BCMR v2 spec

### BCMR Extensions
BCMR identities can declare `extensions` — named plugins that modify a UTXO before NFT parsing. Extensions are registered in `src/parsing/extensions/index.ts` and invoked by the store's `parseNftCommitment` method.

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
├── tokenItems/        # Token display components (FT, NFT)
├── qr/                # QR scanning components
└── general/           # Reusable components (alertDialog, seedPhraseInput, TokenIcon, ...)
```

### Validation
Zod schemas in `utils/zodValidation.ts` validate external data (WalletConnect params, API responses, BCMR data).

### Quasar Framework
Docs: https://quasar.dev/docs

- **Boot files** (`src/boot/`): Run at app startup - `i18n.ts`, `qrCodeComponent.ts`, `deepLinking.ts` (Capacitor only), `plausible.ts` (SPA production only)
- **Plugins**: `Notify` for toasts, `Dialog` for confirmations and custom dialogs (configured in quasar.config.ts)
- **Mode/env detection**: In app code, use Quasar v3 `import.meta.env.QUASAR_*` constants, e.g. `import.meta.env.QUASAR_SPA_MODE`.
- **Capacitor devDependencies**: Capacitor packages are in root `devDependencies` for typechecking; the runtime copies live in `src-capacitor/`

### Styling
Base CSS from a vendored subset of chota (`src/css/chota-subset.css`), custom styles in `src/css/`. Material Icons webfont is vendored in `src/css/material-icons/` (font file + `@font-face` CSS, replaces `@quasar/extras`).

### Internationalization (i18n)
Uses `vue-i18n`. In Vue components use `useI18n()` composable; in utility files use `i18n.global` from `src/boot/i18n.ts`.

## Testing

Unit tests (`/test`, vitest) and E2E tests (`/test/e2e`, Playwright). See `development.md` for full setup details.

## Dependency Pinning

Security-critical dependencies (key material, signing, dApp communication: mainnet-js, libauth, walletkit, @walletconnect/core, indexeddb-storage, cashconnect, wizardconnect) use exact versions in `package.json`; the ones that also appear as transitive deps are pinned graph-wide in the pnpm `overrides` block. Upgrades to these must be deliberate and reviewed — bump both places together. `@wizardconnect/wallet` additionally carries a pnpm patch (`patches/`) fixing a disconnect race — re-check whether it's still needed on upgrades.

## Code Style Preferences

This is a crypto wallet - a security-sensitive environment where being overly careful is preferred over under-careful.

- **Check related files first**: Look for existing patterns before implementing - avoid duplication or accidentally deviating from established conventions
- **Prefer minimalism**: Choose simple, low-complexity solutions; when unsure about complexity, step back and consider carefully
- **Practical security focus**: Address real security concerns, don't get lost in theoretical edge cases
- **Meaningful tests**: Write tests that actually catch issues, not testing theatre
- **Readable over clever**: Prefer simple variable assignment + conditional override over ternaries for complex logic
- **Question necessity**: If something seems unnecessary, it probably is - ask before adding
