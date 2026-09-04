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
import { byteaToHex, BCMR_OUTPUT_PREFIX } from "src/queryChainGraph";

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

export interface DetectedIdentities {
  identities: DetectedIdentity[];
  // The transactions in the walk that carried a publication. The history reads this to tell a
  // metadata update from the wallet's other identity operations: a history item has addresses
  // and values, so the OP_RETURN that says so is not visible in it.
  publicationTxids: string[];
}

export function detectIdentities(spentOutputs: ChaingraphSpentOutput[]): DetectedIdentities {
  const detected = new Map<string, DetectedIdentity>();
  const publicationTxids: string[] = [];
  for (const spentOutput of spentOutputs) {
    const spentTxid = byteaToHex(spentOutput.transaction_hash);
    // only a vout-0 outpoint can be a genesis input, which is what makes the marker cheap
    const couldBeGenesisInput = spentOutput.output_index === "0";
    for (const spender of spentOutput.spent_by) {
      const authheadTxid = byteaToHex(spender.transaction.hash);
      const outputs = spender.transaction.outputs;
      const publishes = outputs.some(
        output => byteaToHex(output.locking_bytecode).startsWith(BCMR_OUTPUT_PREFIX)
      );
      if (publishes && !publicationTxids.includes(authheadTxid)) publicationTxids.push(authheadTxid);

      // a token whose category is the outpoint this transaction spent is a token it created
      const genesised = couldBeGenesisInput
        && outputs.some(output => output.token_category && byteaToHex(output.token_category) === spentTxid);
      if (genesised) {
        detected.set(authheadTxid, { authheadTxid, category: spentTxid, marker: 'genesis' });
        continue;
      }
      if (!publishes || detected.has(authheadTxid)) continue;
      // the identity output of any authchain transaction is its output 0, and a token riding on
      // it names the identity; a BCH-only one is named later from the registry it published
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
  return { identities: [...detected.values()], publicationTxids };
}
