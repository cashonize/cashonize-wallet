// Identities these keys made, read off the spent-outputs walk the portfolio already runs. The
// point is the creator who never opens the identities page: a token genesised with the token
// creation page before that page existed, or an authchain updated with the AuthUpdate CLI on the
// same seed. Their authhead sits in the wallet as an anonymous coin, and an ordinary send spends
// it. Nothing here reaches the network: it is a second reading of a walk already made.
//
// Two markers, which do not overlap. A genesis is a transaction that spent one of this wallet's
// vout-0 outpoints and carries token outputs of the category that outpoint's txid becomes: a
// genesis names its own authbase by construction. A publication is a transaction carrying the
// BCMR output, which catches identities received from elsewhere and first updated here.

import type { ChaingraphSpentOutput } from "src/queryChainGraph";
import { byteaToHex } from "src/queryChainGraph";

// OP_RETURN then a push of "BCMR"; the walk asks for these outputs by this prefix
const BCMR_OUTPUT_PREFIX = "6a0442434d52";

export type IdentityMarker = 'genesis' | 'publication';

export interface DetectedIdentity {
  // The transaction whose output 0 is the identity output. Holding that coin is holding the
  // identity, so it is what decides whether this concerns the wallet at all.
  authheadTxid: string;
  // Named when the marker names it: a genesis names its authbase, and a token-carrying
  // publication names its category on its identity output. A BCH-only chain arrives unnamed and
  // is protected first, named after.
  category?: string;
  marker: IdentityMarker;
}

// The transactions in the walk that carry a publication. The history reads this to tell a
// metadata update from the wallet's other identity operations: a history item has addresses and
// values, so the OP_RETURN that says so is not visible in it.
export function publicationTxids(spentOutputs: ChaingraphSpentOutput[]): string[] {
  const txids: string[] = [];
  for (const spentOutput of spentOutputs) {
    for (const spender of spentOutput.spent_by) {
      const publishes = spender.transaction.outputs.some(
        output => byteaToHex(output.locking_bytecode).startsWith(BCMR_OUTPUT_PREFIX)
      );
      const txid = byteaToHex(spender.transaction.hash);
      if (publishes && !txids.includes(txid)) txids.push(txid);
    }
  }
  return txids;
}

export function detectIdentities(spentOutputs: ChaingraphSpentOutput[]): DetectedIdentity[] {
  const detected = new Map<string, DetectedIdentity>();
  for (const spentOutput of spentOutputs) {
    const spentTxid = byteaToHex(spentOutput.transaction_hash);
    // only a vout-0 outpoint can be a genesis input, which is what makes the marker cheap
    const couldBeGenesisInput = spentOutput.output_index === "0";
    for (const spender of spentOutput.spent_by) {
      const authheadTxid = byteaToHex(spender.transaction.hash);
      const outputs = spender.transaction.outputs;

      // a token whose category is the outpoint this transaction spent is a token it created
      const genesised = couldBeGenesisInput
        && outputs.some(output => output.token_category && byteaToHex(output.token_category) === spentTxid);
      if (genesised) {
        detected.set(authheadTxid, { authheadTxid, category: spentTxid, marker: 'genesis' });
        continue;
      }

      const publishes = outputs.some(
        output => byteaToHex(output.locking_bytecode).startsWith(BCMR_OUTPUT_PREFIX)
      );
      if (!publishes || detected.has(authheadTxid)) continue;
      // the identity output of any authchain transaction is its output 0, and a token riding on
      // it names the identity; a BCH-only one leaves the naming to the backward walk
      const identityOutput = outputs.find(output => output.output_index === "0");
      const category = identityOutput?.token_category
        ? byteaToHex(identityOutput.token_category)
        : undefined;
      detected.set(authheadTxid, {
        authheadTxid,
        ...(category ? { category } : {}),
        marker: 'publication',
      });
    }
  }
  return [...detected.values()];
}

// Naming a chain that carries no token on its identity output. Chaingraph answers forward, from a
// category to its authhead, and has no usable answer backward, so this walks the chain itself: each
// authchain transaction spends the previous identity output, which is that transaction's output 0,
// so hopping through the input that spends a vout-0 outpoint climbs towards the genesis. The
// genesis is where a transaction's token outputs carry the category of the very outpoint it spent,
// which is a definition rather than an index's opinion, and the walk stops there.
//
// One transaction fetch a hop, on the wallet's own electrum. Chains are short, and the cap bounds
// what an unusual one can cost: past it the identity stays protected and unnamed.
export const backwardWalkHopLimit = 25;

interface RawTransaction {
  vin: { txid: string, vout: number }[];
  vout: { n: number, tokenData?: { category: string } }[];
}

// Told apart because they mean different things to the caller: a chain that walked to a
// conclusion is worth remembering as unnameable, while one whose hop could not be fetched says
// nothing at all and must be tried again. Conflating them would let a single network failure
// give up on a chain permanently.
export type ChainNamingResult =
  | { outcome: 'named', category: string }
  | { outcome: 'unnameable' }
  | { outcome: 'unavailable' };

export async function nameChainByWalkingBack(
  authheadTxid: string,
  fetchTransaction: (txid: string) => Promise<RawTransaction>,
  hopLimit = backwardWalkHopLimit,
): Promise<ChainNamingResult> {
  let txid = authheadTxid;
  for (let hop = 0; hop < hopLimit; hop += 1) {
    let transaction: RawTransaction;
    try {
      transaction = await fetchTransaction(txid);
    } catch {
      return { outcome: 'unavailable' };
    }
    // every link walked is one of this chain, so its output 0 is this identity's output; a token
    // identity's output carries its own category, which names the chain without reaching the genesis
    const carried = transaction.vout.find(output => output.n === 0)?.tokenData?.category;
    if (carried) return { outcome: 'named', category: carried };
    // the input that continues the authchain is the one spending a previous identity output
    const parent = transaction.vin.find(input => input.vout === 0);
    // nothing continues the chain here, so there is no genesis to reach: a conclusion, not a gap
    if (!parent) return { outcome: 'unnameable' };
    // a genesis mints the category named by the outpoint it spent, which no later link can do
    const genesised = transaction.vout.some(output => output.tokenData?.category === parent.txid);
    if (genesised) return { outcome: 'named', category: parent.txid };
    txid = parent.txid;
  }
  // walked as far as it is worth walking without finding one
  return { outcome: 'unnameable' };
}
