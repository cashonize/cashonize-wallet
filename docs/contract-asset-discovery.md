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
"script": { "template": "<locktime>b17576a9<ownerPkh>88ac", "addressType": "p2sh20" },
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
also why the format is not CashAssembly, which only compiles, though a hole borrows its
notation and its meaning: every parameter of a p2sh contract is pushed, so <name> is a push and
its opcode follows from the value rather than being written into the literal beside it.

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

## Future items

What a manifest could describe but does not yet. Today one says only where a position is and
what proves it the wallet's; everything below is the route from that to a contract template,
which is discovery and spending together, the two halves a CashScript artifact already has as
its constructor inputs and its unlock functions.

- **Spending paths.** A manifest could carry the unlocking script the way it carries the redeem
  script, as bytecode with its variable parts named, so that `<ownerSig><ownerPubkey>` is the
  whole of the hodl claim. Around it sit the transaction-level facts the contract needs and the
  wallet cannot guess: the nLockTime a `OP_CHECKLOCKTIMEVERIFY` branch requires, and an input
  sequence below its maximum, without which the locktime is not enforced at all. A timestamp
  lock needs one more, which the hodl dapp warns about: the VM compares the locktime against
  the median time past of the last eleven blocks rather than the clock, so a lock is spendable
  roughly an hour after the time it names, and a claim built the moment it matures simply
  fails.

- **One line the format must never have: an output.** A manifest that could name where money
  goes would be a manifest that could take it. The wallet picks the coins, from positions it has
  already proved are its own, and pays them to its own address; the manifest says only how to
  unlock. Held to that, the worst a wrong spending path can do is produce a transaction that
  does not spend, because `SIGHASH_ALL` binds the signature to outputs the manifest had no say
  in. This one holds whichever trust model the format ends up with, since a template trusted
  once still has no business naming a destination, and it has to be enforced by the schema
  having nowhere to put an output rather than by anyone remembering the rule.

- **Output construction.** What remains is then the wallet's: how many of a contract's coins go
  into one transaction, the fee for a spend whose input size it can compute but has not met
  before, and the dust floor below which reclaiming costs more than it returns. The hodl dapp
  sizes it at 150 bytes plus 200 per input and refuses below 546 satoshis, which is a rule of
  thumb worth starting from rather than a number to copy.

- **An action prompt the user can act on.** A spending path needs a sentence in the approval
  modal, and where that sentence comes from is the open question rather than a detail. The
  wallet can compute one for itself, but only out of what it can see: so many coins in, so much
  back to an address of yours. That is true and nearly useless, because it says nothing about
  what the action *means*, and a user cannot judge an action they have not understood.

- **AnyHedge, and why it is not on this list.** It is the largest protocol on Bitcoin Cash by a
  wide margin and cannot be found by any of the above. Its contract address hashes the whole
  agreement, both parties and the oracle among it, so no key of the wallet's derives it; there
  is no announcement; and a wallet that made one knows its own contracts only because a server
  keyed by wallet identity recorded them. Supporting it means accepting such a server, which is
  a different decision from anything here and belongs with the reasoning that kept Chaingraph
  out.

## Prior art, and where this could converge

The format here describes discovery and stops. Two existing systems describe more, and the
question of adopting one rather than growing this is worth keeping open, since the value of a
template is largely in it being shared.

**libauth wallet templates** are already a dependency and already used: `cashconnectStore.ts`
compiles one with `walletTemplateToCompilerBch`. They carry variables, scripts in CashAssembly
and the entities that hold keys, and libauth compiles them. They generate rather than parse,
which is why they cannot serve the recognising half of this format on their own.

**XO templates** ([stack.xo.cash](https://stack.xo.cash)) go further, and are worth reading
before this format grows a spending half. In XO's design a template carries roles, actions,
transactions with their inputs and outputs, scripts in CashASM, and — deliberately — the
user-facing names and descriptions, on the argument that embedding the interface material in
the technical specification is what resolves the trust question rather than what creates it.

XO's claim, in their words, is that a template is *"something that needs to be trusted once,
not at every interaction"*: the user audits a template, or relies on its reputation and
community scrutiny, and thereafter approves actions by intent rather than by inspecting bytes.
Their wallet then verifies "that what is happening matches the intent you were shown", so the
description gives the meaning and the wallet checks the transaction against it.

That is a different trust model from the one this format assumes, and the difference decides
the prompt question above. Held as untrusted data at every use, a manifest's words can only be
labels and the wallet must say everything itself. Held as XO holds a template, trusted once and
visibly, the description is as good as the artifact it came with, and the wallet's job narrows
to checking the facts a wrong description would misstate: the amounts, and which addresses are
the user's own.

Whichever model this ends up with, the division that survives both is worth keeping: the
template supplies meaning, the wallet supplies verification, and the provenance of a template —
shipped here, or added by the user — is the thing the interface must never let blur.

## Where the code is

- `src/stores/store.ts`: `fullWalletHistory`, the loaded history for its readers, and the
  portfolio's use of it.
- `src/utils/contracts/`: the manifest format, and running one against a wallet.
- `src/utils/defi/tapswapListings.ts`: the one announcement parser still written by hand.
- `src/utils/tools/identityDetection.ts`: the identity markers read off the same items.
- `src/components/portfolio/`: where listings and locks are shown, valuation only.
