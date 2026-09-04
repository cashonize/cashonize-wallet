# BCMR Identities in Cashonize

How the wallet models, finds, protects and updates authchain identities, and which of it
is the standard and which is the wallet's own rule. Read this before touching the
identities page, the create page, the identities store or the reservation code. The
standard is [CHIP-BCMR](https://github.com/bitjson/chip-bcmr); the covenant is the
[AuthGuard standard](https://github.com/mr-zwets/AuthGuard)'s, which
[CashTokens Studio](https://cashtokens.studio) implements.

## The model, in the spec's words

- **Authbase.** A transaction. Any transaction can be one; its hash is the identity's
  permanent id and root of trust.
- **Authchain.** The lineage of output 0: the authbase, then the transaction that spent its
  output 0, then the one that spent that transaction's output 0, and so on.
- **Authhead.** The latest transaction in the chain, the one whose output 0 is unspent.
- **Identity output.** That unspent output 0. The wallet calls it the identity's UTXO.
  Whoever holds it holds the identity: spending it to a new address is transfer and key
  rotation in one, and spending it in any other way is what the wallet exists to prevent.
- **Publication.** An output on an authchain transaction, `OP_RETURN "BCMR" <hash> <uri>...`,
  committing to the hash of a registry file hosted off chain and saying where it is
  hosted. A bare domain means the well-known path
  `/.well-known/bitcoin-cash-metadata-registry.json`.
- **Registry.** The hosted JSON file. Its `identities` are keyed by authbase, each a
  history of snapshots by timestamp; the current snapshot is the latest one not after now.

For a token, the authbase is the transaction whose output 0 the genesis spent, so the
token's category is the identity's authbase. That is a consensus fact, not a convention.
The spec's identities are not only tokens: people, organizations and contract systems
are identities too, differing only in having no token on their chain.

## Three rules the wallet holds to

**Forward only.** Resolution goes authbase to authhead, one Chaingraph query. The other
direction has no answer: every transaction is an authbase, so a coin at output 0 sits on
one chain per ancestor and "its" authbase is undefined. The wallet never derives an
authbase from a coin. A coin gets a name from one of three sources only: a token on its
chain (the category names the chain), a registry reached through a publication on its
chain (verified by hash, then each named authbase resolved forward to see whose chain
ends at this coin), or the user pasting the authbase. A coin held back without a name is
the honest state until one of those applies.

**Verified, not trusted.** Chaingraph and electrum are unverified servers, as everywhere
in the wallet. Registry hosting is untrusted by design: the on-chain hash is what
authenticates a file, so every registry the wallet acts on is fetched fresh and hashed
against the chain, and what a publisher is shown before signing comes from that file
parsed, never cast. A name from a registry is accepted only when the hash matches the
publication on this coin's chain and the forward resolution of that authbase ends at this
coin. What a guarded identity's output carries is Chaingraph's claim, since the coin is
not here, and the key an adopted guard is named with comes from the indexer's copy of the
registry; both can only make the wallet compare against a covenant the chain then has to
match, so the worst either can do is hold a coin back.

**Reserve first, tell every time.** An identity output or an AuthKey the wallet holds is
held back from coin selection the moment the wallet knows, without asking, because the
accident it prevents fits in the gap a question would open. The reservation is local and
advisory: another app on the same seed spends the coin regardless, which the copy says
wherever the fact matters. Its effects are visible: the coin leaves the spendable pool,
its BCH leaves the balance, a reserve on it leaves the token list, and a dapp transaction
spending it is refused at signing: outright for an identity UTXO, unless the user option
lets connected apps spend them, and then only when output 0 provably returns to this
wallet, with the approval dialog naming the identity and what its output carries before
and after; a key is signed when the same NFT comes back, since the covenant needs it as an
input. The only releases are the identity's own transfer and Remove on the identities page.

## What the wallet does and does not do

Does: create (a token genesis, or any UTXO at output 0 for an identity that is not a
token), hold identity outputs and keys back, resolve where each listed identity is held,
fetch and hash what the published locations serve, build the publication, reserve and
transfer transactions (all one shape: the old identity output in, the new one at output 0,
the publication output beside it when there is one), mint from an identity UTXO as the
authchain operation it is, and read the chain as the identity's history.

Does not: author or host registries (the generator and the user's hosting do that), build
covenant spends (Studio does), or let a dapp move an identity out of the wallet.

## How an identity gets onto the page

- **Made here.** The create page lists a genesis and reserves its output 0 before any
  indexer has seen it; the identities page's Add new does the same for a picked UTXO.
- **Found in the wallet's own history.** The spent-outputs walk the portfolio already runs
  is read a second time at wallet open for two markers: a genesis these keys made, and a
  publication these keys made. The first names its chain; the second may not, in which
  case the coin is held back unnamed and named on the page's next visit from its own
  registry.
- **Followed as a held token's identity.** The identity of every token the wallet holds is
  followed passively, in batches of forward lookups at open and on the page's visit: not
  listed, not reserved, never news, until its identity output turns out to be here, when it
  is promoted to the list, held back and announced. A setting turns the following off.
- **Added by id.** Any authbase, a token's or not, an identity kept in a guard included.
  The confirm says where the identity is held before listing it: here, and held back, or
  in a covenant this wallet has the key to, or elsewhere, and only watched.
- **Held through a key.** A guarded identity is recognised in the resolve that finds its
  output, by the covenant's bytecode, and the key the wallet holds for it is reserved; a
  key's identity reaches the list the way any held token's does, through the following.

Watched identities reserve nothing and are listed apart from owned ones; the followed token
identities are a third, collapsed group. Whenever the wallet holds something back the user
did not ask it to, a coin found in its history, a key, a promotion, it says so in a dialog
naming what was held back and what that did to the balance.

## Spec versus convention

- **The last publication on the chain.** The spec's resolution reads the publication off
  the authhead transaction's outputs and says nothing about earlier links. The wallet, like
  the token metadata indexer, takes the last publication anywhere on the chain: transfers
  and reserve moves carry none, and those are the operations this wallet makes, so the
  strict reading would leave an identity without a registry after each of them. See the
  future item on carrying the pointer forward.
- **AuthGuard and AuthKey** are the AuthGuard standard's, which CashTokens Studio
  implements: a covenant holding the identity output, opened by an NFT. The covenant's
  script follows from the key's category, so a guarded identity is recognised the way the
  standard verifies one, by deriving the covenant's locking bytecode and comparing it with
  the identity output's; the resolve already carries that output. The key is the identity's
  own category in the standard's genesis setup, or the one the registry names in
  `extensions.authNft` for an identity that adopted a guard later, read off the indexer's
  copy. A key is any NFT of that category with no amount and no capability. The wallet
  protects a key the way it protects an identity output; the covenant's own spends belong
  to the tools that build them.
- **The token metadata indexer** indexes token identities only, keyed by category. That is
  why the identities page resolves and verifies registries itself, and why a non-token
  identity's name comes from its registry, not the indexer.
- **The reserve** is the BCMR spec's reserved supply: the fungible supply held on the
  identity output, which moves with the identity and is issued from the identities page.
  The CashTokens CHIP defines reserved supply by capability instead, and the two
  definitions have not been reconciled; that is tracked upstream in
  [chip-bcmr issue #19](https://github.com/bitjson/chip-bcmr/issues/19).

## Where the code is

- `src/stores/identitiesStore.ts`: the lists, the resolves, the reservations, the finds
  and the following.
- `src/utils/tools/authchainIdentity.ts`: the publication format, registry fetching and
  verification, the operations' outputs, the resolve, the chain's history.
- `src/queryChainGraph.ts`: the authhead and history queries.
- `src/utils/tools/identityDetection.ts`: the two markers read off the spent-outputs walk.
- `src/utils/tools/authGuard.ts`: the covenant's script, and what a key is.
- `src/utils/tools/tokenCreation.ts`: the genesis amounts and the coins a genesis can spend.
- `src/utils/wallet/reservedUtxos.ts`, `src/utils/dapp/reservedInputs.ts`: what a
  reservation is, and how a dapp transaction is judged against it.
- `src/components/settings/identitiesPage.vue`, `identityCard.vue`, `identityActions.ts`,
  `publicationLocations.vue`, `createTokens.vue`, `genesisInputPicker.vue`,
  `src/components/general/identitiesFoundDialog.vue`.

## Future items

What the standard enables that the wallet does not do yet:

- **Identity operations built by dapps.** The standard's point is that identity operations
  are ordinary transactions anyone can build, and a wallet that signs only its own closes
  that off. This release errs on the side of safety: a dapp may spend an identity UTXO only
  with the user option on, and never to move the identity out of the wallet, which is
  restrictive for an identity-management dapp. Only CashTokens Studio exists today and it
  works through the key, which is signed regardless. Loosening this, per dapp or per
  request, is a question for when such a dapp exists.
- **Carrying the metadata pointer forward.** Every operation the wallet builds, a transfer,
  an issue, a reserve move, a mint, leaves the new authhead without a publication output,
  so a resolver that reads only the authhead, as the spec's text says to, finds no registry
  after one. Nothing that exists today reads that way; the wallet and the indexer both walk
  back to the last publication. Two ways to close the gap if it ever matters: re-emit the
  current publication output on every operation, one more output of 40 to 110 bytes each
  time, or have the spec say that the last publication on the chain is the current one,
  which is what every implementation already does.
- **Token metadata from the authchain, without the indexer.** The wallet already follows
  every held token's authchain and reads the last publication on it; fetching that
  registry and hashing it against the chain gives a held token's name, symbol, decimals
  and icon verified rather than served. That makes the token metadata indexer a cache in
  front of what the wallet can check itself, and removes the indexer's limit to token
  identities.
- **Change notices for held tokens.** The spec asks clients to surface a change to a held
  token's name, symbol, decimals or icon, and a burned identity. The followed tier keeps
  each identity's last authhead and publication for this and shows no change yet.
- **Readers for identities that are not tokens.** The wallet makes, holds, watches and
  publishes for the spec's dapp, contract-system and organization identities already;
  nothing reads them yet.
- **Pay-to-domain.** The spec's DNS-resolved registries let a domain in the send field
  resolve to an identity through its well-known registry, the domain as the trust root.
  [CHIP-PayPro](https://github.com/bitjson/chip-paypro) is the invoice layer that composes
  with it: BCMR says who, PayPro says what to pay.
- **The current snapshot.** The spec's current snapshot is the latest one not after now; the
  wallet's own previews and diffs take the last sorted timestamp, so a registry with a
  future-dated snapshot, the pre-announced migration, would show it early.
