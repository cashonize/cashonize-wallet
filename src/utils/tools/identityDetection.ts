// Identities these keys made, read off the wallet's own transaction history. The point is the
// creator who never opens the identities page: a token genesised with the token creation page
// before that page existed, or an authchain updated with the AuthUpdate CLI on the same seed.
// Their authhead sits in the wallet as an anonymous coin, and an ordinary send spends it.
//
// Two markers, which do not overlap. A genesis is a transaction that spent a vout-0 outpoint of
// this history and carries token outputs of the category that outpoint's txid becomes: a genesis
// names its own authbase by construction. A publication is a transaction carrying the BCMR
// output, which catches identities received from elsewhere and first updated here.

import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { TransactionHistoryItem } from "mainnet-js";
import { BCMR_OUTPUT_PREFIX } from "src/queryChainGraph";
import { opReturnHex } from "src/utils/history/txDirection";

export type IdentityMarker = 'genesis' | 'publication';

export interface DetectedIdentity {
  // The transaction whose output 0 is the identity output. Holding that coin is holding the
  // identity, so it is what decides whether this concerns the wallet at all.
  authheadTxid: string;
  // Named when the marker names it: a genesis names its authbase, and a token-carrying
  // publication names its category on its identity output. A BCH-only chain arrives unnamed and
  // is not listed: a non-token identity is listed by the user adding its authbase.
  category?: string;
  marker: IdentityMarker;
}

export interface DetectedIdentities {
  identities: DetectedIdentity[];
  // The transactions in the history that carried a publication. The history view reads this to
  // tell a metadata update from the wallet's other identity operations: a history item has
  // addresses and values, so the OP_RETURN that says so is not visible in it.
  publicationTxids: string[];
}

export type RawTransactionsFetcher = (hashes: string[]) => Promise<Map<string, string>>;

// A history item carries no input outpoints, so a genesis is confirmed from the raw transaction,
// which the history load left in the electrum provider's cache
function spendsGenesisInput(rawHex: string, category: string) {
  const transaction = decodeTransaction(hexToBin(rawHex));
  if (typeof transaction === "string") return false;
  return transaction.inputs.some(
    input => input.outpointIndex === 0 && binToHex(input.outpointTransactionHash) === category
  );
}

// The identity output of any authchain transaction is its output 0, and a token riding on it
// names the identity; a BCH-only one is named later from the registry it published
function publicationOf(transaction: TransactionHistoryItem): DetectedIdentity {
  const category = transaction.outputs[0]?.token?.category;
  return {
    authheadTxid: transaction.hash,
    ...(category ? { category } : {}),
    marker: 'publication',
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

  if (genesisCandidates.length) {
    const rawTransactions = await fetchRawTransactions(genesisCandidates.map(candidate => candidate.transaction.hash));
    for (const { transaction, category } of genesisCandidates) {
      const rawHex = rawTransactions.get(transaction.hash);
      if (rawHex && spendsGenesisInput(rawHex, category)) {
        detected.set(transaction.hash, { authheadTxid: transaction.hash, category, marker: 'genesis' });
        continue;
      }
      // a token sent onward is not a token created, but a publication on the way still counts
      if (publicationTxids.includes(transaction.hash)) detected.set(transaction.hash, publicationOf(transaction));
    }
  }
  return { identities: [...detected.values()], publicationTxids };
}
