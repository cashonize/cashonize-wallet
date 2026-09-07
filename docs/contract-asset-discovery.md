# Contract asset discovery

How the wallet finds what it owns without holding it: assets locked in contracts it funded,
TapSwap listings and hodl locks today, and the identities its keys made. All three are read
off the wallet's own transaction history, and this explains why that history, rather than a
search for the announcements, is the source. Read this before adding a protocol to the
portfolio or changing what is read.

## The problem

A listed NFT sits in a per-listing sale contract; a hodl lock is BCH in a timelock contract; a
token's identity is a coin that may have moved on. The wallet's own coins say nothing about
any of them. What each protocol leaves behind is an announcement, an OP_RETURN output on the
transaction that created the contract, and the question is how to find the announcements
that concern this wallet.

They cannot be searched by key:

- **hodl names no owner.** Its announcement carries the contract's address and the locktime.
  Whose lock it is can only be established by rebuilding the contract from a candidate pkh
  and the announced locktime and comparing the result with the announced address.
- **TapSwap names the maker where no index reaches.** The maker's pkh is the ninth of ten
  pushes, after the price and three want fields of varying length, so its byte position
  differs per listing. An indexer filters script bytes by prefix; "contains these 20 bytes
  somewhere" is not a query one answers.
- **An identity's authbase is a transaction hash**, not an address, and a metadata publication
  names no key at all.

## The wallet's history holds every announcement

Every one of these announcements shares one property: the user paid for the transaction from
their own coins. The announcing transaction therefore spends an output of the wallet's, which
puts it in the electrum history of that output's address, and the wallet loads its full
history at open. mainnet-js fetches the raw transaction of every history item and of every
prevout, through its IndexedDB cache, and decodes them into history items carrying each
output's address and token fields, with an OP_RETURN output's bytes in place of an address.
The announcements are read off those items: `fullWalletHistory` in `src/stores/store.ts`
hands the readers the history on hand when it is complete, and starts the full load itself
when only the capped one is, so the identity check at open does not wait for the browser to
go idle. Nothing is searched, and no server learns the wallet's address list beyond the
electrum server that has it anyway.

Measured on a wallet of about 1,500 transactions against the default servers, the full
history load takes about two seconds served from the cache, a cost the history tab pays at
every open regardless, and reading the announcements off it takes milliseconds. A first open
fetches every transaction, about seven seconds for that wallet, after which the cache serves
them; the identity check waits for that on a fresh restore, which is when a creator's
identity coin is most exposed to an ordinary send.

## What each protocol announces, and what the wallet does with it

- **TapSwap** (`utils/defi/tapswapListings.ts`). Output 0 of the listing transaction is the sale
  contract holding the asset, output 1 the `MPSW` announcement: marker, version, a hash pinning
  the contract's constant bytecode, the platform pkh, the price, three want fields, the maker
  pkh and the fee. A listing is the wallet's when the maker pkh is one of its own, and active
  while output 0 is unspent, which the history cannot say and electrum is asked per listing.
  The format was decoded from settled trades; the contract is not open source.
- **hodl** (`utils/defi/hodlContracts.ts`). Output 0 of the funding transaction is the `hodl`
  announcement: the Lokad id, the contract's address with a version suffix, and the locktime.
  The wallet rebuilds the contract script, `<locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP` around a
  P2PKH of each of its own pkhs, and owns the lock whose script hash matches the announced
  address. What the contract holds is then read from electrum by address, since anyone can add
  funds to it and a drained one holds nothing.
- **Identities** (`utils/tools/identityDetection.ts`). Two markers on the same items: a genesis,
  a transaction carrying tokens of a category that is a transaction of this history, confirmed
  to have spent that transaction's output 0 from its raw form, since a history item carries no
  input outpoints; and a `BCMR` publication output, which also labels the transaction in the
  history. What follows from a find is in `bcmr-identities.md`. The check runs only on a
  network with a Chaingraph instance configured, since listing what it finds needs the resolve.

## The hodl plugin's own rule: a change output back to the owner

The Electron Cash hodl plugin, the protocol's reference, finds contracts from the wallet's own
transaction history too, and recovers the owner differently: it takes the funding
transaction's other outputs, the non-P2SH ones, as candidate owner addresses and rebuilds the
contract from each until one matches the announced address (`contract_finder.py`,
`get_candidates`). That only works when the funding transaction pays an output back to the
owner, so the plugin requires a change output to the owner's own address, and every hodl it
made carries one. Cashonize does not depend on that output, since it rebuilds from its own
pkhs, but a wallet that wants to be found by the plugin has to keep the rule when it creates a
lock.

## The Chaingraph walk that came before

These lookups used to run on Chaingraph: one paged `search_output` query over the wallet's
locking bytecodes, spent outputs only, each with the transaction that spent it and that
transaction's outputs 0 and 1 plus any BCMR output. It answered in about a second for an
ordinary wallet, and asked a second server, with the wallet's full address list, for what the
history load had already delivered. It was also the one query in the wallet that leaned on
`search_output`'s expression index, timing out on an instance with stale planner statistics
while every other query still answered; it carried no node filter, so an instance indexing
both chains answered with rows from both; it lagged electrum by the indexing delay, so a
listing just made needed a second walk; and a wallet with no instance configured found
nothing.

No cheaper Chaingraph shape exists for these lookups, should the question come back. The
announcements name no key an index reaches, and a locking-bytecode equality nested inside
another filter cannot use the address index, so "this OP_RETURN and an output to me" scans the
outputs table and never finishes. Searching by protocol instead grows with the protocol's
use, not the wallet's history. Chaingraph keeps the one job history cannot do: following an
authchain to its head.

## Where the code is

- `src/stores/store.ts`: `fullWalletHistory`, the loaded history for its readers, and the
  portfolio's use of it.
- `src/utils/defi/tapswapListings.ts`, `src/utils/defi/hodlContracts.ts`: the two announcement
  parsers and the ownership rule of each.
- `src/utils/tools/identityDetection.ts`: the identity markers read off the same items.
- `src/components/portfolio/`: where listings and locks are shown, valuation only.
