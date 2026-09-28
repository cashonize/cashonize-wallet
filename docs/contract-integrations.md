# Contract integrations

What the portfolio finds beyond the wallet's own coins, which of it is described by a manifest
and which is still code, and why the line falls where it does. The mechanism is in
`contract-asset-discovery.md`; this is the inventory.

## The three ways a position is found

Sorted by what the wallet needs in hand before it can look, which is also what each costs:

- **A coin you hold.** The position is already in `walletUtxos`, or is keyed by something that
  is. No discovery lookup at all; the question is what the coin holds underneath.
- **An address you can compute.** Fixed, or derived from your own keys. One lookup, or one per
  key.
- **A record in your history.** An announcement is the only pointer. Needs the full history
  load, which only this group does.

## The seven, and what describes each

| protocol | found by | described by | notes |
|---|---|---|---|
| **Badgers.cash** | one fixed address, owner in the NFT commitment | **manifest** | `badgers-stake` |
| **hodl** | announcement, owner by rebuilding the contract | **manifest** | `hodl-vault` |
| **Cauldron** | address derived from your public key hash | **manifest** | `cauldron-pool` |
| **Guanaco** | address derived from your public key hash, per fee tier | **manifest** | `guanaco-pool-1bp` … `-100bp` |
| **TapSwap** | announcement, owner named in it | **manifest** | `tapswap-listing` |
| **Emerald DAO** | a keycard you hold, backing in its commitment | code | belongs to BCMR |
| **ParyonUSD** | a loan key you hold, position at an address its registry names | **BCMR extension** | already data |

Cauldron's price lookups (`cauldronApi.ts`) are not an integration: they price fungible tokens
for the whole portfolio and are unaffected by any of this.

## Derived pools

Cauldron and Guanaco use the third locator, `derived`: the script takes its owner's public key
hash as its only parameter, so the wallet builds it from each of its own key hashes and looks up
the resulting address, and every fungible-token coin there is a pool. No history is read and
nothing is announced to the wallet. Which keys are searched is the wallet's decision rather than
the manifest's: the receive and change addresses that have history, plus a fixed window of the
`defi` chain, because pools created through WizardConnect belong to keys the wallet never hands
out. The lookups go to the wallet's own electrum server; the Cauldron indexer could answer from
the key hashes, but that would hand the wallet's address list to a third party.

Guanaco V1 is a Cauldron fork: the same owner branch and swap conditions, plus a fee tier and a
check that pays a protocol fee to one fixed key hash. The fee tier is a run of opcodes rather than
one push (`OP_5 OP_MUL <10000> OP_DIV` for 0.05%), and a template hole is always one push, so
each tier is its own manifest and its own address. That makes the pool lookups five per key
where Cauldron alone took one; they are not capped like the ones a manifest names, since there is
one per wallet key, and Guanaco is looked up on mainnet only.

Guanaco also announces every pool (`OP_RETURN "GUANAC" <creatorPkh>` beside the pool output),
which is what a protocol-wide TVL has to scan. The wallet does not use it: the announcement
names a key hash rather than an address, and the pool moves on every swap, so neither announcement
shape fits, and derivation finds the same pools without the history.

## What is not manifest work

**Emerald DAO** and **ParyonUSD** are not manifest work at all. Both are the "I hold an asset,
what does it hold underneath?" question, and that is BCMR's job: parsable NFT info already
answers it where the backing is written in the commitment, and a registry extension answers it
where the backing sits elsewhere. ParyonUSD is already data on exactly that path
(`extensions.paryonusd.fetchLoanState.lockingBytecode`); Emerald could be, and its keycard
commitment is a plain two-field layout. Expressing them as contract manifests would duplicate a
mechanism the wallet already has and that the token's own issuer already controls.

## Where each byte layout came from

A manifest is a transcription of somebody else's format, so what it was transcribed from is the
thing to check it against when a protocol changes or a reading looks wrong.

- **Badgers.cash** — the contract at
  [SayoshiNakamario/BadgersStake](https://github.com/SayoshiNakamario/BadgersStake). The lock
  commitment is the payout key hash, eighteen zero bytes, and the lock length in blocks.
- **hodl** — the Electron Cash plugin at
  [mainnet-pat/hodl_ec_plugin](https://github.com/mainnet-pat/hodl_ec_plugin), and the web dapp
  built on it, which write the same three-push announcement. The plugin is also why the address
  is read three ways.
- **Cauldron** — the raw BCH Script pool contract, as the Cauldron dapp builds it: an owner
  branch (`OP_DEPTH OP_IF` pay-to-key-hash) and a constant-product swap branch with a 0.3% fee.
  It is the address the wallet derived before the manifest replaced its module, which the test
  pins.
- **Guanaco** — the production V1 CashAssembly at
  [guanaco-fi/docs](https://github.com/guanaco-fi/docs/tree/main/contract), not the CashScript
  specification beside it, which compiles to different bytecode. The four tiers reconstructed
  from it matched every pool address Guanaco's own parser returned in September 2026, and the
  test pins one real pool.
- **TapSwap** — the contract is **not open source**. The announcement format was decoded from
  settled trades and checked against the developer's parsing example at
  [mainnet-pat/tapswap-subsquid](https://github.com/mainnet-pat/tapswap-subsquid). The version
  bytes in the prefix pin the exact contract the rest of the announcement describes, so a new
  contract version stops matching rather than being read wrong.

## Why two carriers

A protocol whose user holds one of its tokens can describe itself in that token's BCMR registry.
That is hash-committed on the authchain and verified by the wallet, so the description is
authenticated and self-published: nobody uploads anything, and impersonation is impossible
because the identity proves who published it.

A protocol whose user holds nothing has no such identity to speak through, so somebody has to
tell the wallet where to look. That is the contract manifest, and it is why the trust work — the
built-in versus user-added distinction, the caps, the impersonation rules — lives on that side
and not the other.

## Ownership

A position's manifest says what its balance means for the holder, because that decides whether
the portfolio may add it to a total:

- `owned` — yours to take at will. A TapSwap listing is this: the contract holds the asset, but
  cancelling returns it at any moment, with nothing to wait for.
- `encumbered` — yours, temporarily locked. Badgers and hodl are both this, and both count
  today.
- `shared` — you hold part and the wallet cannot know which part. A multisig, and AnyHedge.
  Shown, not counted.
- `claim` — contingent or future. Being the payee of a recurring payment, or the inheritor of a
  dead man's switch. Shown, not counted.

Ownership is not the same axis as whether a position counts. A listed NFT is fully owned and
still stays out of the total, because no price is known for it — the portfolio keeps listings out
"like other NFTs". Ownership says whether a balance may be counted; valuation says whether it can
be.

The precedent is `includeReserves` in `portfolioView.vue`, off by default because "an identity's
reserve priced at the pool is a fiction". The same care applies here: a total that sums a
balance the wallet cannot spend, or can only partly claim, is a total that lies.

## What a manifest may not do

The route from describing where a position is to describing how to spend it, and the one line
the format must never gain, is under Future items in `contract-asset-discovery.md`.


A manifest is inert. It names bytes, offsets, lengths and bounds, and nothing in it is ever
evaluated. That is a deliberate limit rather than an accident of the format: a user-added bundle
is untrusted input that makes the wallet derive addresses and query servers.

It cannot claim someone else's coin, because ownership is always proved against the wallet's own
keys. It can misdescribe what a position is worth, so values from a user bundle read as the
claims they are. The attack that matters is impersonation — a bundle taking a built-in's name
and icon makes a phishing story credible — so user bundles are visibly distinct and cannot take
either. Lookups are capped, since a manifest naming addresses the wallet never chose would
otherwise decide how long a wallet open takes.

## Where the code is

- `src/utils/contracts/contractManifest.ts` — the format, its schema, and reading and building
  against it.
- `src/utils/contracts/runManifest.ts` — running one against a wallet.
- `src/utils/contracts/builtinContracts.json` — the bundle the wallet ships, in the same shape a
  user's bundle has.
- `src/utils/wallet/walletKeyHashes.ts` — the key hashes a manifest's owner is matched against
  or built from, the `defi` chain among them.
- `src/utils/defi/` — the integrations still written as modules: Emerald, and Cauldron's price
  lookups.
- `src/parsing/extensions/` — the ones carried by BCMR instead.
