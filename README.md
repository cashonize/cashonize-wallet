![Cashonize Banner](docs/images/cashonize-banner.png)

## Cashonize: a modern Bitcoin Cash Wallet

**Cashonize is an easy-to-use, multi-platform Bitcoin Cash wallet.**

It is available as a webwallet, a desktop application (for Windows & Linux), an Android APK and an installable web app, and comes in English, Spanish, French, German, and Portuguese.

For users, the [Cashonize about page](https://about.cashonize.com) introduces the wallet and its features, while this readme goes into more detail.

### Your entry point to CashTokens and BCH DeFi

CashTokens are Bitcoin Cash's native tokens, the foundation of BCH DeFi. Cashonize was the first CashTokens wallet and has been built around them from day one.

On Bitcoin Cash, dapps never hold your funds: your wallet is where every action gets approved. Cashonize is designed around that role.

Cashonize works with any dapp on BCH: it supports all three connection methods in the ecosystem (WalletConnect, CashConnect and WizardConnect) and shows you plainly what a transaction will do to your balances before you sign.

The portfolio view values your BCH, tokens and DeFi positions together, so you always know where you stand.

### The wallet for you?

Because of its minimalist design and modern look, Cashonize is a user-friendly wallet, even for inexperienced users.

Cashonize lets you create and switch between multiple wallets. There are two wallet types supported: single-address wallet and HD wallet. HD wallets use a new address for each transaction, providing basic privacy for everyday payments.

Cashonize does not currently support password or pin locked wallets and encrypted seed phrases.

### Features

- **Send & receive BCH and CashTokens** - Full support for fungible tokens and NFTs
- **Connect to dApps via WalletConnect** - Easy-to-understand transaction preview screen
- **WizardConnect support** - Connect HD wallets to dApps through the Nostr-based WizardConnect protocol
- **Open-source and non-custodial** - You control your keys
- **Multi-wallet support** - Create and manage multiple wallets (single-address or HD)
- **Minimalist design** - Easy to use with a clean, modern interface
- **Fast and lightweight** - Quick startup, fast data loading, and snappy navigation
- **Streamlined onboarding** - New users are guided through wallet creation and preferences setup
- **Localization** - Available in English, Spanish, French, German, and Portuguese
- **Transaction history** - Filterable, searchable history with private transaction notes
- **Minimal dependencies** - Fewer third-party packages means less code to trust and easier to audit
- **HD address management** - Address overview with balances, labels and marking addresses as used
- **Wallet tools** - Sign and verify messages, freeze and label coins and HD addresses, and transfer all assets to another wallet
- **Sweep functionality** - Sweep BCH and CashTokens from paper wallets, cashstamps, or private keys


### Exclusive Features

- **CashConnect support** - Connect to BCH-native dApps through the CashConnect protocol
- **Detailed dApp transaction preview** - Shows your balance changes for BCH and tokens before signing
- **Portfolio view** - Chart of your total wallet value across your assets and DeFi positions
- **Portfolio integrations** - Also values your Cauldron liquidity pools, ParyonUSD loans and stakes
- **Dapp-aware history** - Labels dapp transactions and classifies swaps as combined, both filterable
- **Token pills in history** - Token changes shown as pills with icon and amount in the history
- **Token management** - Favorite, hide, and search tokens
- **Cauldron price display** - View live Cauldron DEX prices for fungible tokens
- **Parsable NFTs** - Decode NFT commitments and display their data as human-readable attributes (parsable BCMR support)
- **ParyonUSD loan keys** - Supports the ParyonUSD loan key extension to fetch and display live loan state
- **Flipstarter pledges** - Make and cancel pledges to Flipstarter campaigns from the wallet
- **TapSwap listings** - Shows the assets you have listed for sale on TapSwap in the portfolio
- **Hodl contracts** - Shows BCH locked in hodl timelock contracts in the portfolio
- **Create tokens** - Pick the token id coin and keep part of the supply as a protected reserve
- **Identities** - Finds, adds, protects and deliberately transfers the identities your keys hold
- **Metadata publishing** - Verifies your BCMR registry against its on-chain hash and publishes it
- **AuthKey support** - Recognizes and protects AuthKey NFTs and shows the identities they control

## Platforms

🖥️ Desktop version (Windows, Linux): https://github.com/cashonize/cashonize-wallet/releases

📱 Android apk: https://github.com/cashonize/cashonize-wallet/releases

🌐 Webwallet: [cashonize.com](cashonize.com) 

📲 Installable Web App: Look for the **Add to Home Screen / Install** setting in your browser on [cashonize.com](cashonize.com) 

⚠️ [cashonize.com](cashonize.com) is the only correct URL for the webwallet <br>

## Security

Cashonize is available for different platforms from the same codebase, but the platform variants have different security properties worth understanding.

The webwallet is the easy way to start; for meaningful amounts the downloadable apps are recommended. The webwallet runs whatever cashonize.com serves on each visit, so a change to the site reaches every web user at once, while the desktop and Android apps keep the version you installed until you update. Installable web apps share the webwallet's security model, despite feeling like a native app.

For more details see the [security considerations](./security-considerations.md), and the [security policy](./SECURITY.md) for responsible disclosure.

## Local Development 

</> For local development check out the [developer instructions](./development.md).

🗺️ For an overview of the architecture, see [AGENTS.md](./AGENTS.md): written to guide AI agents, it doubles as the codebase's architecture documentation.

## For dApp Developers

Cashonize supports three connection methods for dapps: [WalletConnect](https://github.com/mainnet-pat/wc2-bch-bcr) (following the WC2-BCH spec), [CashConnect](https://cashconnect.developers.cash/) and [WizardConnect](https://gitlab.com/riftenlabs/lib/wizardconnect).

- The [example WalletConnect dApp](./test/e2e/test-dapp) is a minimal reference for connecting to Cashonize, sending requests and handling responses.
- The [`docs`](./docs) folder contains protocol documentation, such as the [`bch_cancelPendingRequests`](./docs/walletconnect-cancellation.md) WalletConnect method for dismissing stale signing dialogs and how the wallet handles [BCMR identities](./docs/bcmr-identities.md).

## License & Disclaimer

The Cashonize source code is released under the [MIT license](./LICENSE), a permissive open-source license.

The Cashonize name and logo are not covered by the MIT license: they remain the intellectual property of the Cashonize project and may not be used to brand forks or derived products without permission.

Cashonize is non-custodial software provided "as is", without warranty of any kind. You are solely responsible for safeguarding your seed phrases and funds; the authors and contributors cannot recover lost wallets and accept no liability for any loss of funds arising from the use of this software.

## Built on

Cashonize is built on the work of:
- Jason Dreyzehner (bitjson) for [libauth](https://libauth.org/), which does the wallet's cryptography, signing and transaction encoding
- mainnet-pat for [mainnet-js](https://github.com/mainnet-pat/mainnet-js), which [bch-wallet-lib](https://github.com/cashonize/bch-wallet-lib) continues
- Jonathan Silverblood for [electrum-cash](https://gitlab.com/electrum-cash/network), through which the wallet reads the blockchain

🙏 Special thanks to mainnet-pat, jimtendo and rnbrady for their major contributions to the project!

The project's history, and everyone who helped along the way, are in [History and acknowledgements](./docs/history.md).
