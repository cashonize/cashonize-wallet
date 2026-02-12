# WalletConnect Test dApp

Minimal example WalletConnect dApp for Cashonize E2E tests. Connects to the wallet over the WalletConnect
relay network, sends requests and displays responses.

## Usage

```bash
yarn install
yarn dev
```

Then open http://localhost:5188 in your browser. Port 5188 is an arbitrary choice
intended to be high enough to avoid conflicts with other dev servers which might be running.

Also launched automatically by Playwright via the `webServer` config in `test/e2e/playwright.config.ts`.

## Manual testing

1. Start Cashonize: `yarn dev` from project root
2. Start this dApp: `yarn dev` from this folder
3. Click Connect, copy the pairing URI into Cashonize's WalletConnect tab
4. Use the buttons to send requests and approve/reject in Cashonize
