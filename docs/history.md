# History

How Cashonize grew, from a page for minting tokens on a test network to a full wallet with its own library.

## Before Cashonize

In 2021, BCH Watchlist, a small app tracking the balances of named BCH addresses, was the first experiment with mainnet-js, the library Cashonize would be built on. In December 2022, mainnet-pat released mainnet-js 1.0.0 with CashTokens and token metadata support, months before the upgrade reached mainnet.

## 2023: the first CashTokens wallet

Cashonize started on 8 January 2023, three weeks later, as a single page for creating fungible tokens and NFTs on chipnet. That was four months before CashTokens went live. Sending tokens followed the next day. Seed phrase import and BCMR token metadata came in February, and NFT collections in April.

The mainnet option went in the evening before the CashTokens upgrade. The upgrade activated on 15 May 2023, and token balances worked that same afternoon, once a mainnet-js fix asked the electrum servers for token UTXOs. That made Cashonize the first CashTokens wallet on Bitcoin Cash.

WalletConnect came in October, built by mainnet-pat and jimtendo. CashConnect, built by jimtendo, followed at the end of December, making Cashonize the first wallet to support it.

## 2024: the rewrite

Cashonize started out as a web-only wallet in plain JavaScript. In January 2024 a new codebase began in Vue, Quasar and TypeScript, with a desktop app ten days later and an Android app in March. The rewrite was a goal of the Cashonize Flipstarter, and a setback at first: most of 2024 went into catching up with the old wallet.

By v0.2.0 in September the rewrite had every important feature, and the original codebase was archived the same day. It is still on GitHub as the [legacy wallet](https://github.com/cashonize/legacy-wallet).

## 2025: an everyday wallet

Cashonize gained a transaction history, a QR scanner, auto-approve for WalletConnect, a UTXO list and private key sweeping. Its WalletConnect support was brought in line with the spec, and the first tests landed.

## 2026: a full wallet

Named wallets came in January. Three weeks later came HD wallets, for better transaction privacy, and the first translations. The same release made Cashonize the first wallet to display parsable NFTs.

In July, WizardConnect joined WalletConnect and CashConnect. A run of feature releases followed. The portfolio made Cashonize the first wallet to show BCH, tokens and DeFi positions as one, and wallet tools, Flipstarter pledging and identities came after it.

In October, bch-wallet-lib replaced mainnet-js. It is forked from mainnet-js and keeps the same storage format, so every wallet loads unchanged.
