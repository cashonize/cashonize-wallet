# Contract asset discovery

How the wallet finds what it owns without holding it: assets locked in contracts it funded,
TapSwap listings and hodl locks today, and the identities its keys made. All three are found
by one walk of the wallet's own spent outputs on Chaingraph, and this explains why that walk,
rather than a search for the announcements, is the query. Read this before adding a protocol
to the portfolio or changing what the walk asks for.

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
  differs per listing. Chaingraph filters script bytes by prefix only; "contains these 20
  bytes somewhere" is not a query it can answer.
- **An identity's authbase is a transaction hash**, not an address, and a metadata publication
  names no key at all.

What Chaingraph does answer fast is "which outputs have this locking bytecode", and every one
of these announcements shares one property: the user paid for the transaction from their own
coins. The announcing transaction therefore spends an output of the wallet's, and the set of
transactions that spent the wallet's outputs contains every announcement it ever made.

## The walk

One paged query (`querySpentOutputs` in `src/queryChainGraph.ts`): the wallet's locking
bytecodes, every address of an HD wallet, into `search_output`, spent outputs only, each with
the transaction that spent it and that transaction's outputs 0 and 1 plus any BCMR output at
another index, with whether each of those is spent in turn. The announcements are read on the
client from those outputs. Nothing is searched globally, and the query's size follows the
wallet's history, not the protocols' use: about half a second warm for an ordinary wallet on a
healthy instance, paged in thousands of rows for a busy one. It is the wallet's one request
that leans on `search_output`'s expression index, so an instance whose planner statistics have
gone stale times it out at a handful of addresses while every other query still answers.

The walk runs once per state of the wallet's coins (`walkSpentOutputs` in `store.ts`): at
wallet open, for identity detection, and the portfolio's first visit reads the same answer.
It sends the wallet's full address list to the configured Chaingraph server, which is the
privacy cost of every lookup in this document. The query is keyed by address and carries no
node filter, so an instance that indexes both chains answers it with rows from both; that is
why the instance is a setting per network, and why chipnet ships with none configured. The
portfolio's two protocols exist on mainnet only, so its lookup runs on mainnet only; identity
detection runs wherever an instance is configured for the network.

## What each protocol announces, and what the wallet does with it

- **TapSwap** (`utils/defi/tapswapListings.ts`). Output 0 of the listing transaction is the sale
  contract holding the asset, output 1 the `MPSW` announcement: marker, version, a hash pinning
  the contract's constant bytecode, the platform pkh, the price, three want fields, the maker
  pkh and the fee. A listing is the wallet's when the maker pkh is one of its own, and active
  while output 0 is unspent, which the same query reports. The format was decoded from settled
  trades; the contract is not open source.
- **hodl** (`utils/defi/hodlContracts.ts`). Output 0 of the funding transaction is the `hodl`
  announcement: the Lokad id, the contract's address with a version suffix, and the locktime.
  The wallet rebuilds the contract script, `<locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP` around a
  P2PKH of each of its own pkhs, and owns the lock whose script hash matches the announced
  address. What the contract holds is then read from electrum by address, since anyone can add
  funds to it and a drained one holds nothing.
- **Identities** (`utils/tools/identityDetection.ts`). Two markers on the same rows: a genesis,
  a transaction that spent one of the wallet's output-0 outpoints and carries tokens of the
  category that outpoint's txid becomes; and a `BCMR` publication output, which also labels
  the transaction in the history. What follows from a find is in `bcmr-identities.md`.

## The hodl plugin's own rule: a change output back to the owner

The Electron Cash hodl plugin, the protocol's reference, finds contracts from the wallet's own
transaction history and recovers the owner differently: it takes the funding transaction's
other outputs, the non-P2SH ones, as candidate owner addresses and rebuilds the contract from
each until one matches the announced address (`contract_finder.py`, `get_candidates`). That
only works when the funding transaction pays an output back to the owner, so the plugin
requires a change output to the owner's own address, and every hodl it made carries one.
Cashonize does not depend on that output, since it rebuilds from its own pkhs, but a wallet
that wants to be found by the plugin has to keep the rule when it creates a lock.

## The electrum alternative

A transaction that spends an address's coin is in that address's electrum history, so the same
walk can be done without Chaingraph: the history of every address, then each transaction
fetched and its outputs read. The hodl plugin does exactly this, and for TapSwap it was
verified to find the same listings as the Chaingraph walk. It is one round trip per
transaction rather than one paged query, which is why the wallet uses Chaingraph. It is not
built today: a wallet with no Chaingraph instance configured finds none of these. It would be
the way to find them without any server knowing the wallet's address list as a set.

## Where the code is

- `src/queryChainGraph.ts`: the walk's query and its paging.
- `src/stores/store.ts`: `walkSpentOutputs`, one walk per state of the wallet, and the
  portfolio's use of it.
- `src/utils/defi/tapswapListings.ts`, `src/utils/defi/hodlContracts.ts`: the two announcement
  parsers and the ownership rule of each.
- `src/utils/tools/identityDetection.ts`: the identity markers read off the same rows.
- `src/components/portfolio/`: where listings and locks are shown, valuation only.
