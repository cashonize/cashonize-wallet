# IndexedDB and networks

What Cashonize keeps in IndexedDB, how wallets map to networks there, and the history of wallets
that exist on two networks. Read this before changing how wallets are created, stored or deleted,
or before adding a network.

## The databases

IndexedDB belongs to the libraries; the app keeps its own data in localStorage (see AGENTS.md).

- **`bitcoincash`**: the mainnet wallets, one row per wallet name holding its wallet id, which
  holds the seed phrase.
- **`bchtest`**: the chipnet wallets, the same way.
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

A wallet is created or imported on one network: mainnet by default, chipnet from the developer
settings ("Add chipnet wallet"). The network follows the wallet: the wallet list opens a wallet on
mainnet when it has a mainnet row and on chipnet otherwise, and there is no network switch of its
own. A name with rows on both networks (a tied wallet, below, or a chipnet wallet of another seed
that early versions made under the same name) can be opened on chipnet from the developer
settings. A wallet name
belongs to one wallet across all networks, since the wallet type, backup status and other settings
are keyed by the name alone.

The library can hold more networks (`registerNetwork`, each with its own database), but the app
supports mainnet and chipnet only. Adding testnet4, scalenet or regtest means gating each feature
on the network first: the electrum settings, explorer, token metadata indexer, Chaingraph,
Cauldron, WalletConnect's chain and the per-network localStorage keys still branch on mainnet
versus chipnet (#368).

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

1. The section shows only when the chipnet row is exactly the mainnet id with its network replaced.
2. "Check chipnet history" reads the copy's addresses on chipnet: the one address of a
   single-address wallet, or the first 20 receive and change addresses of an HD wallet.
3. Only a copy with no history is offered for removal, behind a confirmation. A used copy is kept,
   and so is one whose history could not be read.
4. On removal the history is read again, and then, immediately before the delete, both rows: the
   chipnet row must still be the copy that was checked and the mainnet row must still hold the
   same keys. Reading the rows last catches a change during the slow history read, such as
   another tab deleting the wallet and making a new one of that name. Anything else deletes
   nothing. While a removal runs, the store opens no wallet on another network, so the copy
   being removed cannot become the open wallet.

Removing the copy deletes the chipnet row only; its keys stay in the mainnet row. The copy's
chipnet data in localStorage (notes, labels and the like) is kept: no other wallet can take the
name while the mainnet one holds it, and deleting the wallet removes that data with it.
