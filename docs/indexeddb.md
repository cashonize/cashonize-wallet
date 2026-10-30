# IndexedDB and networks

What Cashonize keeps in IndexedDB, how wallets map to networks there, and the history of wallets
that exist on two networks. Read this before changing how wallets are created, stored or deleted,
or before adding a network.

## The databases

IndexedDB belongs to the libraries; the app keeps its own data in localStorage (see AGENTS.md).

- **`bitcoincash`**: the mainnet wallets, one row per wallet name holding its wallet id, which
  holds the seed phrase.
- **`bchtest`**: the chipnet wallets, the same way.
- **`bchtest4`**: the testnet4 wallets, the same way. Testnet4 is not built into the library: the
  app registers it as `utils/wallet/networks.ts` loads, which has to come before any testnet4
  wallet loads and before `pruneWalletCaches`, which drops the cached keys of a network it does
  not know. A version from before testnet4 knows nothing of this database: its "delete all
  wallets" leaves the testnet4 wallets here, and it can give a mainnet wallet a testnet4 wallet's
  name.
- **`ElectrumNetworkProviderCache`**: raw transactions and block headers read from electrum.
- **`WalletCache`**: each HD wallet's derived addresses with their private keys, status and history.
- WalletConnect's session state, and `cashconnect-*` databases.

The wallet databases' names come from the library (`networkConfig(network).dbName`, through
`utils/wallet/networks.ts`), not from string literals in the app. The settings menu's cache-size
and delete-all flows still open these databases directly.

## Chipnet is "testnet" in storage

The app says chipnet everywhere a person sees a network, and in its own localStorage keys. The
library's name for chipnet is its built-in network `testnet`, which mainnet-js 3.1.7 used, and the
stored format keeps it:

- wallet ids: `hd:testnet:<seed phrase>:<path>:0:0`, `seed:testnet:…`;
- the `bchtest` database, named after the address prefix;
- the cache keys and HD cache ids, which include the network name.

These are never renamed: a rename would break a rollback to an older version and make every
chipnet HD wallet rediscover its addresses. `utils/wallet/networks.ts` maps between the two names
(`libraryNetwork`, `appNetworkOf`).

## One network per wallet

A wallet is created or imported on one network: mainnet by default, or a test network, chipnet
or testnet4, from the developer settings ("Add development wallet"). The network follows the
wallet: the wallet list opens a wallet on its own network, mainnet for a name with rows on both
mainnet and chipnet (a tied wallet, below, or a chipnet wallet of another seed that early versions
made under the same name), whose chipnet side opens from the developer settings. There is no
network switch of its own. A wallet name belongs to one wallet across all networks, since the
wallet type, backup status and other settings are keyed by the name alone.

Everything per network goes over `appNetworks`: the wallet list, cache pruning, deletion and the
per-wallet localStorage keys, the electrum providers, and the per-network settings (electrum
server and mode, explorer, Chaingraph, token metadata indexer), which settingsStore keeps as one
entry per network under the keys mainnet and chipnet always had. A network gets what it has a
backend for: testnet4 has electrum servers and explorers, but no token metadata indexer, Cauldron
or CashTokens Studio, so those are off there, and no Chaingraph instance by default. It also
makes no dApp connections: WalletConnect and CashConnect name a test network only by its bchtest
prefix and WizardConnect only by its xpub version, so a dApp could not tell it from chipnet.

## Tied wallets

Older versions stored every wallet created or imported twice: the mainnet row, and a chipnet row
holding the mainnet id with `mainnet` replaced by `testnet`. Such a pair is tied: the same seed
phrase and paths on both networks, so each chipnet address is the matching mainnet address with
another prefix, and a message signed on chipnet is a valid signature for the mainnet address too.
Every extra network would have meant another copy of every seed phrase.

New wallets get no copy. Existing pairs are left as they are: someone who never uses chipnet never
touches the copy, and nothing is migrated automatically.

A developer can untie the open wallet in the developer settings
(`utils/wallet/tiedWallets.ts`):

1. The "Wallet also on chipnet" section shows for any name with rows on both networks; checking
   and removing are offered only when the chipnet row is exactly the mainnet id with its network
   replaced.
2. "Check if removable" reads what the copy holds on chipnet: the one address of a
   single-address wallet, or an HD wallet's receive, change and WizardConnect defi chains, each
   followed until 20 addresses in a row are unused, with the unspent coins of every used address.
   Coins past a longer gap are not found, as the wallet's own discovery would not find them
   either. Electrum looks addresses up by script hash, which is the same on mainnet and chipnet, so
   the check shows the chipnet server the script hashes of the mainnet wallet's first addresses,
   as opening the copy always did.
3. A copy that holds no coins, never used or used and emptied, is offered for removal, behind a
   confirmation: nothing is lost, as its keys are in the mainnet row and its history stays on the
   chain. A copy holding BCH or tokens is kept, and so is one whose coins could not be read; the
   developer can send the coins to another chipnet wallet and check again.
4. On removal the coins are read again, and then, immediately before the delete, both rows: the
   chipnet row must still be the copy that was checked and the mainnet row must still hold the
   same keys. Reading the rows last catches a change during the slow chipnet reads, such as
   another tab deleting the wallet and making a new one of that name. Anything else deletes
   nothing. While a removal runs, the store opens no wallet on another network, so the copy
   being removed cannot become the open wallet.

Removing the copy deletes the chipnet row only; its keys stay in the mainnet row. The copy's
chipnet data in localStorage (notes, labels and the like) is kept: no other wallet can take the
name while the mainnet one holds it, and deleting the wallet removes that data with it.
