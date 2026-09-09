# Contract asset discovery

How the wallet finds what it owns without holding it: assets locked in contracts it funded,
TapSwap listings and hodl locks today, and the identities its keys made. All three are read
off the wallet's own transaction history, and this explains why that history, rather than a
search for the announcements, is the source. Read this before adding a protocol to the
portfolio or changing what is read.

A protocol is described by a manifest rather than implemented as a module, so what follows is
the reasoning a manifest encodes rather than a design any one integration is free to redo.
The inventory of which protocols are described that way today, and what the format still lacks
for the rest, is in `contract-integrations.md`.

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

## How an announcement is described

What a protocol announces is data, not code. A manifest names the output the announcement sits
at, the bytes it starts with, how many pushes it has and what each carries, and — where the
announcement names no owner — the contract to rebuild from the wallet's own keys and compare
against. The hodl announcement in full:

```json
"find": {
  "kind": "announcement",
  "output": 0,
  "prefix": "6a04686f646c",
  "pushes": 3,
  "fields": {
    "announcedScriptHash": { "push": 1, "as": "addressHash" },
    "locktime": { "push": 2, "as": "utf8int", "min": 1, "max": 4294967295 }
  }
},
"script": { "template": "{locktime}b17576a914{ownerPkh}88ac", "addressType": "p2sh20" },
"owner": { "kind": "rebuild", "ownerField": "ownerPkh", "matches": "announcedScriptHash" }
```

The announced address is read as the hash it commits to rather than as the string it was written
in, because creating software writes it three ways: a legacy base58 address, a cashaddr, and a
cashaddr with its prefix stripped. Comparing the rendered address would match only the middle
one, which is a mistake worth naming because it is invisible until a real announcement of the
other kinds is tried.

The script is written the way the contract is built rather than as a list of opcodes, because a
real contract is hundreds of bytes and because written that way it runs both directions: the
same template generates a script from parameters and reads parameters back out of one. That is
also why the format is not CashAssembly, which only compiles.

A manifest describes a shape rather than an instance, so a bundle can be added before any of its
contracts exist. Nothing in one is evaluated.

Which protocols this covers today, which are still modules, and what the format is missing for
each: `contract-integrations.md`.

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

## Chaingraph, evaluated and set aside

Chaingraph was the first source for these lookups, and the question of using it comes down to
two facts.

**The electrum data is already paid for.** The history load fetches every transaction of the
wallet's at the first open and serves it from the IndexedDB cache at every open after; the
history tab needs that load regardless, so reading announcements off it costs nothing extra
and needs no cache of its own. A Chaingraph lookup is a request on top of that, at every open
and every portfolio visit, to a second server that then holds the wallet's full address list.

**Chaingraph cannot ask for just the wallet's announcements.** Its one fast lookup is outputs
by locking bytecode, through `search_output`'s expression index, and no announcement is
reachable by it: hodl names no owner, TapSwap names the maker past any prefix, a genesis has
no marker at all. What was left was the same walk the history gives for free: the wallet's
spent outputs with the transaction that spent each, one paged query, the announcements
filtered on the client. The shapes a lookup can take here, and what rules each out:

- **By the wallet's addresses**, the walk: outputs by locking bytecode through the expression
  index, then the transaction that spent each. The one fast shape; it grows with the wallet's
  history, and can be narrowed on the server to spending transactions that carry an
  announcement or a token output, since that filter reaches through the relationship without
  touching the address index.
- **By the protocol**, an OP_RETURN prefix search: finds every announcement anyone made, so it
  grows with the protocol's use, and the owner still has to be matched on the client, which
  for hodl means deriving the contract from every own pkh per announcement. Workable while a
  protocol is small, wrong as it grows, and no help for a genesis, which has no marker.
- **Both at once**, "this OP_RETURN and an output to me": a locking-bytecode equality nested
  inside another filter cannot use the expression index, so Postgres scans the outputs table
  and the statement timeout cancels it. The server can do either half, not the join.
- **By the contract**: a hodl address hashes the locktime with the pkh, a TapSwap contract
  hashes the whole offer, so neither is derivable from what the wallet knows.
- **By the listed token's category**: needs categories the wallet no longer holds and grows
  with the collection.

That walk also had costs of its own. It was the one query in the wallet that leaned on the
expression index, timing out on an instance with stale planner statistics while every other
query still answered; it carried no node filter, so an instance indexing both chains
answered with rows from both; it lagged electrum by the indexing delay, so a listing just
made needed a second walk; and a wallet with no instance configured found nothing. Chaingraph
keeps the one job history cannot do: following an authchain to its head.

## Where the code is

- `src/stores/store.ts`: `fullWalletHistory`, the loaded history for its readers, and the
  portfolio's use of it.
- `src/utils/contracts/`: the manifest format, and running one against a wallet.
- `src/utils/defi/tapswapListings.ts`: the one announcement parser still written by hand.
- `src/utils/tools/identityDetection.ts`: the identity markers read off the same items.
- `src/components/portfolio/`: where listings and locks are shown, valuation only.
