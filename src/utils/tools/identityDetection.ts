// Identities these keys made, read off the wallet's own transaction history. The point is the
// creator who never opens the identities page: a token genesised with the token creation page
// before that page existed, or an authchain updated with the AuthUpdate CLI on the same seed.
// Their authhead sits in the wallet as an anonymous coin, and an ordinary send spends it.
//
// Two markers, which do not overlap. A genesis is a transaction that spent a vout-0 outpoint of
// this history and carries token outputs of the category that outpoint's txid becomes: a genesis
// names its own authbase by construction. A publication is a transaction carrying the BCMR
// output, which catches identities received from elsewhere and first updated here. Each is then
// followed forward to the link the chain has got to.

import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { TransactionHistoryItem } from "mainnet-js";
import { BCMR_OUTPUT_PREFIX } from "src/queryChainGraph";
import { opReturnHex } from "src/utils/history/txDirection";

export type IdentityMarker = 'genesis' | 'publication';

export interface DetectedIdentity {
  // The transaction whose output 0 is the identity output, as far down the chain as this history
  // reaches. Holding that coin is holding the identity, so it is what decides whether this
  // concerns the wallet at all.
  authheadTxid: string;
  // Named when the marker names it: a genesis names its authbase, and a token-carrying
  // publication names its category on its identity output. A BCH-only chain arrives unnamed and
  // is not listed: a non-token identity is listed by the user adding its authbase.
  category?: string;
  marker: IdentityMarker;
  // The BCMR outputs of a publication, for naming a chain whose identity output carries no
  // token from the registry they commit to
  publicationOutputs?: string[];
}

export interface DetectedIdentities {
  identities: DetectedIdentity[];
  // The transactions in the history that carried a publication. The history view reads this to
  // tell a metadata update from the wallet's other identity operations: a history item has
  // addresses and values, so the OP_RETURN that says so is not visible in it.
  publicationTxids: string[];
}

export type RawTransactionsFetcher = (hashes: string[]) => Promise<Map<string, string>>;

// Which transaction spent each output 0. A history item carries no input outpoints, so this is
// read from the raw transactions the history load left in the electrum cache; one index answers
// both what makes a candidate a genesis and where a chain went next.
function indexOutput0Spends(rawTransactions: Map<string, string>) {
  const spenders = new Map<string, string>();
  for (const [txid, rawHex] of rawTransactions) {
    const transaction = decodeTransaction(hexToBin(rawHex));
    if (typeof transaction === "string") continue;
    for (const input of transaction.inputs) {
      if (input.outpointIndex === 0) spenders.set(binToHex(input.outpointTransactionHash), txid);
    }
  }
  return spenders;
}

// A marker fires on the link that carries it, which is rarely the chain's last: a mint, a transfer
// or a reserve move continues the chain at output 0 and publishes nothing. Whatever spends an
// identity output continues the chain, and nothing spends an output it creates, so this terminates.
function advanceToAuthhead(marked: string, spenders: Map<string, string>) {
  let authhead = marked;
  let next = spenders.get(authhead);
  while (next !== undefined) {
    authhead = next;
    next = spenders.get(authhead);
  }
  return authhead;
}

// The identity output of any authchain transaction is its output 0, and a token riding on it
// names the identity; a BCH-only one is named later from the registry it published
function publicationOf(transaction: TransactionHistoryItem): DetectedIdentity {
  const category = transaction.outputs[0]?.token?.category;
  const publicationOutputs = transaction.outputs
    .map(output => opReturnHex(output))
    .filter((hex): hex is string => hex !== undefined && hex.startsWith(BCMR_OUTPUT_PREFIX));
  return {
    authheadTxid: transaction.hash,
    ...(category ? { category } : {}),
    marker: 'publication',
    publicationOutputs,
  };
}

export async function detectIdentities(
  history: TransactionHistoryItem[],
  fetchRawTransactions: RawTransactionsFetcher,
): Promise<DetectedIdentities> {
  const historyTxids = history.map(transaction => transaction.hash);
  const detected = new Map<string, DetectedIdentity>();
  const publicationTxids: string[] = [];
  const genesisCandidates: { transaction: TransactionHistoryItem, category: string }[] = [];
  for (const transaction of history) {
    const publishes = transaction.outputs.some(output => opReturnHex(output)?.startsWith(BCMR_OUTPUT_PREFIX));
    if (publishes) publicationTxids.push(transaction.hash);

    const createdCategory = transaction.outputs
      .map(output => output.token?.category)
      .find(category => category !== undefined && historyTxids.includes(category));
    if (createdCategory) {
      genesisCandidates.push({ transaction, category: createdCategory });
      continue;
    }
    if (publishes) detected.set(transaction.hash, publicationOf(transaction));
  }
  // nothing marked is nothing to follow, and most wallets decode nothing at all
  if (!detected.size && !genesisCandidates.length) return { identities: [], publicationTxids };

  // The whole history, since a link can be told from an ordinary transaction only by its inputs:
  // splitting the tokens off an identity, or emptying its reserve, leaves the chain continuing on
  // a plain BCH output that nothing marks.
  const rawTransactions = await fetchRawTransactions(historyTxids);
  // one batch read of the cache the history load filled, whose transactions mainnet-js decoded in
  // full to build that history
  const spenders = indexOutput0Spends(rawTransactions);

  for (const { transaction, category } of genesisCandidates) {
    if (spenders.get(category) === transaction.hash) {
      detected.set(transaction.hash, { authheadTxid: transaction.hash, category, marker: 'genesis' });
      continue;
    }
    // a token sent onward is not a token created, but a publication on the way still counts
    if (publicationTxids.includes(transaction.hash)) detected.set(transaction.hash, publicationOf(transaction));
  }

  // A chain this history holds several markers for, a genesis and the publications after it,
  // walks to one authhead; the genesis is the more informative marker, so it is the one kept.
  const identities = new Map<string, DetectedIdentity>();
  for (const identity of detected.values()) {
    const authheadTxid = advanceToAuthhead(identity.authheadTxid, spenders);
    if (identities.get(authheadTxid)?.marker === 'genesis') continue;
    identities.set(authheadTxid, { ...identity, authheadTxid });
  }
  return { identities: [...identities.values()], publicationTxids };
}
