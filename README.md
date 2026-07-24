![Cashonize Banner](https://github.com/cashonize/cashonize-wallet/assets/53938059/fd6b8244-76ba-4d3d-9b84-c757e0fb0e21)

## Cashonize: a Bitcoin Cash Wallet

**Cashonize is an easy-to-use, multi-platform Bitcoin Cash wallet** <br>
Cashonize supports CashTokens and the WalletConnect, CashConnect and WizardConnect connection methods, which makes it an ideal wallet for using dapps on BCH. <br>
Currently Cashonize is available as a webwallet, a desktop application (for Windows & Linux), an Android APK and an Installable web app. <br>

Cashonize is available in English, Spanish, French, German, and Portuguese.

### The wallet for you?

Because of its minimalist design, Cashonize is a user-friendly wallet, even for inexperienced users.
Cashonize has an easy-to-understand transaction preview screen for WalletConnect, CashConnect and WizardConnect, empowering users before signing DeFi transactions.
Further, Cashonize nicely groups and displays your NFTs, making it ideal for NFT collectors.

Cashonize lets you create and switch between multiple wallets. There are two wallet types supported: single-address wallet and HD wallet. HD wallets use a new address for each transaction, providing basic privacy for everyday payments.

Cashonize does not currently support password or pin locked wallets and encrypted seed phrases.

### Features

- **Send & receive BCH and CashTokens** - Full support for fungible tokens and NFTs
- **Connect to dApps via WalletConnect** - Easy-to-understand transaction preview screen
- **WizardConnect support** - Connect HD wallets to dApps through the Nostr-based WizardConnect protocol
- **Open-source and non-custodial** - You control your keys
- **Multi-wallet support** - Create and manage multiple wallets (single-address or HD)
- **Minimalist design** - Easy to use with a clean, simple interface
- **Fast and lightweight** - Quick startup, fast data loading, and snappy navigation
- **Streamlined onboarding** - New users are guided through wallet creation and preferences setup
- **Localization** - Available in English, Spanish, French, German, and Portuguese
- **Sweep functionality** - Sweep BCH and CashTokens from paper wallets, cashstamps, or private keys
- **Minimal dependencies** - Fewer third-party packages means less code to trust and easier to audit

### Exclusive Features

- **CashConnect support** - Connect to BCH-native dApps through the CashConnect protocol
- **Detailed dApp transaction preview** - Shows your balance changes for BCH and tokens before signing
- **Token management** - Favorite, hide, and search tokens
- **Cauldron price display** - View live Cauldron DEX prices for fungible tokens
- **Parsable NFTs** - Decode NFT commitments and display their data as human-readable attributes (parsable BCMR support)
- **ParyonUSD loan keys** - Supports the ParyonUSD loan key extension to fetch and display live loan state

## Platforms

🖥️ Desktop version (Windows, Linux): https://github.com/cashonize/cashonize-wallet/releases

📱 Android apk: https://github.com/cashonize/cashonize-wallet/releases

🌐 Webwallet: [cashonize.com](cashonize.com) 

📲 Installable Web App: Look for the **Add to Home Screen / Install** setting in your browser on [cashonize.com](cashonize.com) 

⚠️ [cashonize.com](cashonize.com) is the only correct URL for the webwallet <br>

## Security

Cashonize is available for different platforms from the same codebase, but the platform variants have different security properties worth understanding.

Webwallets are great for convenience, but downloaded applications are more secure because the code is pinned at install time rather than fetched fresh on every visit. Installable web apps share the same security model as webwallets, despite feeling like a native app.

For more details see the [security considerations](./security-considerations.md).

## Local Development 

</> For local development check out the [developer instructions](./development.md).

## Special Thanks to

🙏 Special thanks to mainnet-pat, jimtendo and rnbrady for their major contributions to the project!

Thanks to damascene & bitjson for helping with the early formation of the project.

The 2024 work on the project was enabled by the financial support of the [flipstarter contributors](https://flipstarter.cashonize.com/). <br>
In special: molecular, Mike Komaransky, 'BCH Conference', toorik and majamalu.

Further thanks to bitcoincashautist, Joemar, Romit and Kallisti for being very helpful responding to questions. <br>
Also a thank you to users reporting bugs: samrock5000, Stockleezy and Steve Thurmond.

## Historic version

🪦 Before Cashonize became a Vue-Typescript application built with Quasar, it was a vanilla JS project. <br>
You can find the legacy codebase [here](https://github.com/cashonize/wallet).
