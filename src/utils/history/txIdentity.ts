// Since the wallet publishes metadata and manages reserves itself, it makes authchain history of
// its own, and in the ordinary transaction history those read as inscrutable self-sends with an
// OP_RETURN. This names them, the way isDappInteraction names a dapp interaction.
//
// Store-agnostic by design, like its neighbours: it is handed the identities and the publication
// txids rather than reaching for them.

import type { TransactionHistoryItem } from "mainnet-js";

export type IdentityOperationKind = 'metadataUpdate' | 'identityOperation';

export interface IdentityOperation {
  category: string;
  kind: IdentityOperationKind;
}

export interface IdentityChain {
  category: string;
  // every transaction of the chain, which is what makes a transaction recognisable as one of its
  // operations rather than only the latest being known
  links?: string[];
}

// A transaction belonging to a listed identity's authchain is an operation on that identity.
// Whether it published metadata is told by the spent-outputs walk, which already reads the BCMR
// output the history item itself cannot see: a history item carries addresses and values, and an
// OP_RETURN has neither.
export function identityOperationOf(
  transaction: TransactionHistoryItem,
  identities: IdentityChain[],
  publicationTxids: string[],
): IdentityOperation | undefined {
  const identity = identities.find(listed => listed.links?.includes(transaction.hash));
  if (!identity) return undefined;
  return {
    category: identity.category,
    kind: publicationTxids.includes(transaction.hash) ? 'metadataUpdate' : 'identityOperation',
  };
}
