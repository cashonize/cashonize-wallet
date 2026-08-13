# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues or pull requests. Report privately, either through [GitHub's private vulnerability reporting](https://github.com/cashonize/cashonize-wallet/security/advisories/new) or by email to mr-zwets@protonmail.com.

Include steps to reproduce, the platform and version you saw it on (webwallet, installable web app, desktop or Android), and what an attacker gains. Never include a seed phrase or private key you actually use.

We aim to respond within a few days, and will credit you in the release notes unless you prefer otherwise. There is no bug bounty program.

If you do not hear back within a week, feel free to ping [@GeukensMathieu](https://x.com/GeukensMathieu) on X to say you sent a report, without any details.

## Supported Versions

Only the latest release is supported: fixes ship in a new release rather than being backported. If you run a desktop or Android build, update to the [latest release](https://github.com/cashonize/cashonize-wallet/releases) before reporting.

## Scope

Out of scope are the known trade-offs documented in the [security considerations](./security-considerations.md), in particular the plaintext seed storage and the code delivery model of the webwallet, along with third-party dapps, Electrum servers and metadata indexers that Cashonize connects to.

Vulnerabilities in mainnet-js, libauth, WalletKit, CashConnect or WizardConnect belong with those projects, but we would still like to know so we can assess the impact and pin a fixed version.

## Disclosure

Please give us time to ship a fix before disclosing publicly. Desktop and Android builds only update when users install a new release, so a fix in the repository is not the same as users being protected.
