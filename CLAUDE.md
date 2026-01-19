# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cashonize is a Bitcoin Cash (BCH) wallet supporting CashTokens, WalletConnect, and CashConnect. Built with Vue 3 (Composition API with `<script setup>`), TypeScript, Quasar Framework, and Pinia for state management. Targets multiple platforms: web (SPA), desktop (Electron), and mobile (Capacitor).

## Commands

Uses yarn classic (v1).

```bash
yarn dev              # Start development server (opens browser)
yarn build            # Production build (generates dist/stats.html bundle analysis)
yarn lint             # ESLint check
yarn test             # Run vitest tests
yarn vue-tsc --noEmit # Type check (Vue projects use vue-tsc, not plain tsc)
```

## Architecture

### View Navigation
The app uses a single-page architecture where `WalletPage.vue` is the only route. Views are switched via `store.displayView` number:
- 1: BchWallet, 2: MyTokens, 3: TxHistory, 4: ConnectDapp, 5: SettingsMenu
- 6: CreateTokens, 7: UtxoManagement, 8: SweepPrivateKey, 9: AddWallet
- undefined/0: WalletOnboarding (shown when no wallet exists)

Views use `<KeepAlive>` to preserve state across navigation, except settingsMenu which re-renders.

### State Management (Pinia Stores)
- **store.ts**: Main wallet state - `_wallet` (mutable ref), `wallet` (computed, throws if null), balance, UTXOs, token list, BCMR registries. Handles wallet initialization, network switching, transaction watching.
- **settingsStore.ts**: User preferences persisted to localStorage - currency, dark mode, electrum servers, per-wallet backup status, auto-approve settings for WalletConnect.
- **walletconnectStore.ts** / **cashconnectStore.ts**: dApp connection protocol handlers. Instantiated with wallet ref passed in.

### Multi-Wallet Support
- Wallets stored in IndexedDB via `@mainnet-cash/indexeddb-storage` (databases: "bitcoincash" for mainnet, "bchtest" for chipnet)
- `activeWalletName` persisted in localStorage
- `dbUtils.ts`: Direct IndexedDB operations for checking wallet existence, listing wallets, deletion
- Wallets can exist on one or both networks; UI disables unavailable network options

### mainnet-js (Core Wallet Library)

The wallet functionality is powered by `mainnet-js`, built on `@bitauth/libauth` for cryptographic primitives and transaction building, and `@electrum-cash/network` for blockchain data fetching from Electrum servers.

- `Wallet` for mainnet, `TestNetWallet` for chipnet
- Named wallets persist to IndexedDB via `@mainnet-cash/indexeddb-storage`
- Docs: https://mainnet.cash/tutorial/

### Other Key Dependencies
- **@bitauth/libauth**: Cryptographic primitives, transaction encoding (https://libauth.org/)
- **@reown/walletkit**: WalletConnect integration (wraps @walletconnect/* packages)
- **cashconnect**: CashConnect protocol for BCH-native dApp connections

### Component Organization
```
src/components/
├── bchWallet.vue, myTokens.vue, connectDapp.vue, settingsMenu.vue  # Main tab views
├── walletOnboarding.vue                                             # Initial setup
├── settings/          # Components accessed from settings menu
├── walletconnect/     # WC2 session and dialog components
├── cashconnect/       # CC session and dialog components
├── history/           # Transaction history components
├── tokenItems/        # Token display components (FT, NFT)
├── qr/                # QR scanning components
└── general/           # Reusable components (alertDialog, seedPhraseInput, emojiItem)
```

### Validation
Zod schemas in `utils/zodValidation.ts` validate external data (WalletConnect params, API responses, BCMR data).

### Quasar Framework
Docs: https://quasar.dev/docs

- **Boot files** (`src/boot/`): Run at app startup - `qrCodeComponent.ts` (always), `deepLinking.ts` (Capacitor only)
- **Plugins**: `Notify` for toasts, `Dialog` for confirmations and custom dialogs (configured in quasar.config.ts)
- **MODE detection**: `process.env.MODE` is `"spa"` (browser), `"electron"` (desktop), or `"capacitor"` (mobile)

### Styling
Base CSS from `chota` (minimal CSS framework), custom styles in `src/css/`.

## Testing

Tests are in `/test` directory using vitest. Run a single test file:
```bash
yarn test test/walletUtils.test.ts
```

## Code Style Preferences

This is a crypto wallet - a security-sensitive environment where being overly careful is preferred over under-careful.

- **Check related files first**: Look for existing patterns before implementing - avoid duplication or accidentally deviating from established conventions
- **Prefer minimalism**: Choose simple, low-complexity solutions; when unsure about complexity, step back and consider carefully
- **Practical security focus**: Address real security concerns, don't get lost in theoretical edge cases
- **Meaningful tests**: Write tests that actually catch issues, not testing theatre
- **Readable over clever**: Prefer simple variable assignment + conditional override over ternaries for complex logic
- **Question necessity**: If something seems unnecessary, it probably is - ask before adding
