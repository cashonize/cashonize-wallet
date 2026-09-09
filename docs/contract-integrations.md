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

## The six, and what describes each

| protocol | found by | described by | notes |
|---|---|---|---|
| **Badgers.cash** | one fixed address, owner in the NFT commitment | **manifest** | `badgers-stake` |
| **hodl** | announcement, owner by rebuilding the contract | **manifest** | `hodl-vault` |
| **Cauldron** | address derived from your public key hash | code | needs a `derived` locator |
| **TapSwap** | announcement, owner named in it | code | needs two additions, below |
| **Emerald DAO** | a keycard you hold, backing in its commitment | code | belongs to BCMR |
| **ParyonUSD** | a loan key you hold, position at an address its registry names | **BCMR extension** | already data |

Cauldron's price lookups (`cauldronApi.ts`) are not an integration: they price fungible tokens
for the whole portfolio and are unaffected by any of this.

## What the manifest format cannot express yet

Stated as what is missing rather than as a promise about when.

**Cauldron** needs a third locator, `derived`: build the script from each of the wallet's own
public key hashes and look up the resulting address. The script template already expresses the
contract — `cauldronPools.ts` builds it by string concatenation exactly as a manifest would —
so what is missing is only the locator and a way to name which key chains to search. Cauldron
searches its `defi` chain as well, because pools created through WizardConnect belong to keys
the wallet never hands out.

**TapSwap** needs two things. Its owner is named *in the announcement* rather than proved by
rebuilding, so the announcement path needs the `field` ownership rule the address path already
has. And its contract is output 0 of the announcing transaction rather than an address the
announcement names, so `find` needs to be able to say "the position is output N of the
transaction that announced it". Liveness is then whether that one output is unspent, rather
than what an address holds.

**Emerald DAO** and **ParyonUSD** are not manifest work at all. Both are the "I hold an asset,
what does it hold underneath?" question, and that is BCMR's job: parsable NFT info already
answers it where the backing is written in the commitment, and a registry extension answers it
where the backing sits elsewhere. ParyonUSD is already data on exactly that path
(`extensions.paryonusd.fetchLoanState.lockingBytecode`); Emerald could be, and its keycard
commitment is a plain two-field layout. Expressing them as contract manifests would duplicate a
mechanism the wallet already has and that the token's own issuer already controls.

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

- `owned` — spendable now.
- `encumbered` — yours, temporarily locked. Badgers and hodl are both this, and both count
  today.
- `shared` — you hold part and the wallet cannot know which part. A multisig, and AnyHedge.
  Shown, not counted.
- `claim` — contingent or future. Being the payee of a recurring payment, or the inheritor of a
  dead man's switch. Shown, not counted.

The precedent is `includeReserves` in `portfolioView.vue`, off by default because "an identity's
reserve priced at the pool is a fiction". The same care applies here: a total that sums a
balance the wallet cannot spend, or can only partly claim, is a total that lies.

## What a manifest may not do

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
- `src/utils/defi/` — the integrations still written as modules.
- `src/parsing/extensions/` — the ones carried by BCMR instead.
