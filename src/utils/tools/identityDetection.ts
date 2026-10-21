// Identities these keys made, read off the wallet's own transaction history. The point is the
// creator who never opens the identities page: a token genesised with the token creation page
// before that page existed, or an authchain updated with the AuthUpdate CLI on the same seed.
// Their authhead sits in the wallet as an anonymous coin, and an ordinary send spends it.
//
// Two markers, which do not overlap. A genesis is a transaction that spent a vout-0 outpoint of
// this history and carries token outputs of the category that outpoint's txid becomes: a genesis
// names its own authbase by construction. A publication is a transaction carrying the BCMR
// output, which catches identities received from elsewhere and first updated here. Each is then
// followed forward to the link the chain has got to, through key-held outputs and AuthGuards only
// (why: docs/bcmr-identities.md, Spec versus convention).

import type { TransactionHistoryItem } from "@cashonize/bch-wallet-lib";
import type { ScannedTransaction } from "src/utils/history/transactionIndex";
import { BCMR_OUTPUT_PREFIX } from "src/queryChainGraph";
import { opReturnHex } from "src/utils/history/txDirection";
import { isAuthGuardOf } from "src/utils/tools/authGuard";

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

// Which transaction spent each output 0, read off the history's own inputs. One index answers both
// what makes a candidate a genesis and where a chain went next. Both a history item and a scanned
// transaction carry each input's outpoint, which is what keeps this pass off the network.
function indexOutput0Spends(history: ScannedTransaction[]) {
  const spenders = new Map<string, string>();
  for (const transaction of history) {
    for (const input of transaction.inputs) {
      if (input.outpointIndex === 0 && input.outpointTransactionHash) {
        spenders.set(input.outpointTransactionHash, transaction.hash);
      }
    }
  }
  return spenders;
}

// OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
export function isP2pkh(lockingBytecode: string) {
  return lockingBytecode.length === 50 && lockingBytecode.startsWith("76a914") && lockingBytecode.endsWith("88ac");
}

// An AuthGuard requires its AuthKey at input 1 of every spend, so the link spending the covenant
// says which key opened it, and the key's category derives the covenant: a match proves the guard,
// and the covenant already checked the key's shape when the spend was accepted
function opensAuthGuard(spender: ScannedTransaction, covenantBytecode: string) {
  const keyCategory = spender.inputs[1]?.token?.category;
  return keyCategory !== undefined && isAuthGuardOf(keyCategory, covenantBytecode);
}

// Whether the spender of an identity output, locked by this bytecode, takes the chain on: a key-held
// output moves with whatever spends it, a covenant only when that spend opens it as an AuthGuard
export function continuesAuthchain(output0Bytecode: string, spender: ScannedTransaction) {
  return isP2pkh(output0Bytecode) || opensAuthGuard(spender, output0Bytecode);
}

// A marker fires on the link that carries it, which is rarely the chain's last: a mint, a transfer
// or a reserve move continues the chain at output 0 and publishes nothing. Whatever spends an
// identity output continues the chain, and nothing spends an output it creates, so this terminates.
function advanceToAuthhead(marked: string, spenders: Map<string, string>, transactions: Map<string, ScannedTransaction>) {
  let authhead = marked;
  let next = spenders.get(authhead);
  while (next !== undefined) {
    // the history reports the bytecode too, and without it the walk stops here
    const lockingBytecode = transactions.get(authhead)?.outputs[0]?.lockingBytecode;
    const spender = transactions.get(next);
    if (!lockingBytecode || !spender) break;
    if (!continuesAuthchain(lockingBytecode, spender)) break;
    authhead = next;
    next = spenders.get(authhead);
  }
  return authhead;
}

// The identity output of any authchain transaction is its output 0, and a token riding on it
// names the identity; a BCH-only one is named later from the registry it published
function publicationOf(transaction: ScannedTransaction): DetectedIdentity {
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

// The listed identities the walk above no longer reaches, which earlier versions held back: a genesis
// these keys signed into a contract as the contract's own NFT, followed out of it to a coin of this
// wallet by a settlement. Only where the history holds the link past the contract, so a gap in it is
// not taken for one, and only for a category this wallet never received any of.
export function contractStateIdentities(
  history: TransactionHistoryItem[],
  held: { category: string, authheadTxid: string }[],
): string[] {
  const spenders = indexOutput0Spends(history);
  const transactions = new Map(history.map(transaction => [transaction.hash, transaction]));
  return held.filter(({ category, authheadTxid }) => {
    const genesisTxid = spenders.get(category);
    const genesis = genesisTxid === undefined ? undefined : transactions.get(genesisTxid);
    if (!genesisTxid || !genesis?.outputs.some(output => output.token?.category === category)) return false;
    const reached = advanceToAuthhead(genesisTxid, spenders, transactions);
    if (reached === authheadTxid || spenders.get(reached) === undefined) return false;
    const contractOutput = transactions.get(reached)?.outputs[0];
    if (contractOutput?.token?.category !== category || !contractOutput.token.nft) return false;
    const received = history.some(transaction => transaction.tokenAmountChanges.some(change =>
      change.category === category && (change.amount > 0n || change.nftAmount > 0n)
    ));
    return !received;
  }).map(identity => identity.category);
}

function publishes(transaction: ScannedTransaction) {
  return transaction.outputs.some(output => opReturnHex(output)?.startsWith(BCMR_OUTPUT_PREFIX));
}

// The first token category of its outputs that is a transaction of the history: the category a
// genesis would create, which it is when the transaction spends that transaction's output 0
function createdCategoryOf(transaction: ScannedTransaction, historyTxids: ReadonlySet<string>) {
  return transaction.outputs
    .map(output => output.token?.category)
    .find(category => category !== undefined && historyTxids.has(category));
}

// What makes a transaction a marker, for keeping it without the rest of the history: it publishes,
// or it is the genesis of the category it creates
export function isIdentityMarker(transaction: ScannedTransaction, historyTxids: ReadonlySet<string>) {
  if (publishes(transaction)) return true;
  const category = createdCategoryOf(transaction, historyTxids);
  return transaction.inputs.some(input => input.outpointIndex === 0 && input.outpointTransactionHash === category);
}

// The transactions may be the whole history or the ones kept for it (utils/history/transactionIndex.ts),
// with the txids of the whole history then given apart
export function detectIdentities(
  history: ScannedTransaction[],
  historyTxids: ReadonlySet<string> = new Set(history.map(transaction => transaction.hash)),
): DetectedIdentities {
  const transactions = new Map(history.map(transaction => [transaction.hash, transaction]));
  const spenders = indexOutput0Spends(history);
  const detected = new Map<string, DetectedIdentity>();
  const publicationTxids: string[] = [];
  const genesisCandidates: { transaction: ScannedTransaction, category: string }[] = [];
  for (const transaction of history) {
    const publication = publishes(transaction);
    if (publication) publicationTxids.push(transaction.hash);

    const createdCategory = createdCategoryOf(transaction, historyTxids);
    if (createdCategory) {
      genesisCandidates.push({ transaction, category: createdCategory });
      continue;
    }
    if (publication) detected.set(transaction.hash, publicationOf(transaction));
  }
  for (const { transaction, category } of genesisCandidates) {
    if (spenders.get(category) === transaction.hash) {
      detected.set(transaction.hash, { authheadTxid: transaction.hash, category, marker: 'genesis' });
      continue;
    }
    // a token sent onward is not a token created, but a publication on the way still counts
    if (publicationTxids.includes(transaction.hash)) detected.set(transaction.hash, publicationOf(transaction));
  }

  // A chain this history holds several markers for, a genesis and the publications after it,
  // walks to one authhead; the genesis is the more informative marker, so it is the one kept, and
  // of two publications one that names a category.
  const identities = new Map<string, DetectedIdentity>();
  for (const identity of detected.values()) {
    const authheadTxid = advanceToAuthhead(identity.authheadTxid, spenders, transactions);
    const kept = identities.get(authheadTxid);
    if (kept?.marker === 'genesis') continue;
    if (kept?.category && !identity.category) continue;
    identities.set(authheadTxid, { ...identity, authheadTxid });
  }
  return { identities: [...identities.values()], publicationTxids };
}
