# dApp sessions and wallet switches

A dApp pairs with one wallet on one network. Cashonize holds several wallets and has one open at a
time, so every session has to answer two questions: which wallet does it belong to, and what
happens to it while another wallet is open. Sessions are kept across a wallet or network switch
and resume when their wallet is opened again. A request is only ever served by the wallet its
session was paired with.

## Per protocol

| | Where the sessions live | How a session knows its wallet | While another wallet is open |
|---|---|---|---|
| WalletConnect | WalletKit's own IndexedDB, one set for the whole app | A record in localStorage, topic to `network:walletName` (`utils/dapp/wcSessionWallets.ts`) | Still connected. Signing requests are refused, address requests answered from the session |
| WizardConnect | Pairing URIs in localStorage, per `network:walletName` | The key the URI is saved under | Closed, without telling the dApp. Reconnected by the next `start()` for that wallet |
| CashConnect | localStorage, per wallet identity key (derived from the wallet's keys, the same on each of its networks) and network | The identity key | Stopped. Restored by the next `start()` for that wallet |

## WalletConnect is one instance per app

WalletKit and its `Core` are not per wallet, and cannot simply be made so:

- `new Core()` looks up `globalThis._walletConnectCore_<customStoragePrefix>` and, when one exists,
  takes over that Core's parts and ignores the new options (it warns "WalletConnect Core is already
  initialized"). Two WalletKits made the ordinary way therefore share one Core: the same storage,
  keychain, relayer, pairings and sessions.
- A different `customStoragePrefix` gets its own global slot and its own storage keys, which is the
  way to separate two instances. The lookup is also skipped when `process.env.DISABLE_GLOBAL_CORE`
  is `"true"`, but the web build replaces `process.env` at build time, so that switch is not
  available here.
- This is read from `@walletconnect/core` 2.25.0. Two Cores side by side have not been run.

So the app sets WalletKit up once (`initweb3wallet`), every wallet's sessions sit in that one
instance, and the wallet is fixed per request instead of per instance.

One consequence of the single instance:

- The sign client has one session request queue for all sessions and hands out the next request
  only once the current one is answered. A request for a wallet that is not open is therefore
  refused at once rather than left waiting: left pending, it would hold up the requests of every
  other session until it expires. The same queue is why cancellation needs polling, see
  `walletconnect-cancellation.md`.

## How a WalletConnect request is served

1. A signing request (`bch_signTransaction`, `bch_signMessage`) takes the open wallet on arrival
   and compares it with the session's record (`walletForRequest`). On a mismatch the dApp gets
   error 4100 and the user a notice naming the wallet, or the network, to switch to.
2. The wallet taken on arrival is held for the whole request: the keys, the broadcast and the
   activity log entry all come from it. Signing is refused when it is no longer the wallet open,
   since the reserved-inputs check reads the open wallet's reservations.
3. The key is checked against the address the dApp was given at pairing, through the HD address
   cache or `hasAddress` (`sessionSigningKeys` in `utils/dapp/wcSigning.ts`). The record decides what is listed and served; this check is what keeps a
   wrong record from signing with another wallet's key.
4. `bch_getAddresses` is answered from the session's own accounts, whichever wallet is open.

The wallet's identity comes from the wallet object (`wallet.network`, `wallet.name`), not from the
store's `activeWalletName`: a switch changes the name before it changes the wallet.

## WizardConnect

The manager is made per `start()` for one wallet, with the HD nodes derived from it, so signing
never reads another wallet's keys. `stop()` closes the connections with `closeAll()`, which a pnpm
patch adds to `@wizardconnect/wallet` over its own close-without-message path: the library's public
`disconnect` always tells the dApp the session ended. Reconnecting a saved URI re-derives the same
relay identity, so the dApp recognises the wallet, as it does after an app reload. A request that
was waiting when the wallet was left is not answered.

## When sessions end

- The user disconnects one, or the dApp does, or a WalletConnect session expires.
- "Clear dApp connections" removes every wallet's sessions on all three protocols. The dApps of
  the open wallet are told, and every WalletConnect dApp; the WizardConnect and CashConnect
  sessions of the other wallets are forgotten without a message.
- Deleting a wallet ends its WalletConnect sessions on every network and forgets its WizardConnect
  pairings (those dApps are not told), so a new wallet under the same name inherits none.
- A WalletConnect session with no wallet recorded can be served by no wallet, so it is ended at
  startup. That is what happens once to sessions made before the record existed.
- Converting a wallet to HD ends its WalletConnect sessions (they name the single address) and its
  CashConnect sessions (the identity key changes). Removing a chipnet copy ends the copy's
  WalletConnect sessions.

## Limits

- **Several browser tabs.** Every tab receives a WalletConnect request. A tab with another wallet
  open refuses it at once, which the dApp usually sees before the right tab's dialog is answered.
  dApp sessions are reliable with one tab, or with every tab on the same wallet.
- **A switch during a WizardConnect broadcast.** The transaction goes out from the wallet that
  signed and is logged for it, but the session's connection is closed by the switch, so the dApp
  gets no answer and may ask again for a transaction that is already out.
- **Nothing is queued for a wallet that is not open.** The dApp has to send a refused request
  again once the user has switched.

## Why not a store per wallet

A Pinia store factory taking the wallet as an argument is not a supported pattern: Pinia's
maintainer turned it down (vuejs/pinia#3056), and a store disposed and re-created under one id gets
its old state back unless that is deleted by hand. The direction for CashConnect is a plain
per-wallet object held by the store and replaced on a switch; the reasoning and the probes behind
it are in issue #444.
