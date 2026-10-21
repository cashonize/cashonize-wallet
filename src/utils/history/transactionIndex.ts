// The few transactions of the wallet's history its own features look for: the identity markers and
// the authchain links after them, and the TapSwap and hodl announcements. Kept per wallet per
// network, so an open decodes what arrived since the last one rather than the whole history, and
// only their outputs and input outpoints, never the prevouts a history item is built from.

import {
  decodeTransaction,
  hexToBin,
  Opcodes,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { InOutput, TokenI, TxI } from "@cashonize/bch-wallet-lib";
import { toHex } from "@cashonize/bch-wallet-lib";
import { listingOffer } from "src/utils/defi/tapswapListings";
import { hodlAnnouncement } from "src/utils/defi/hodlContracts";
import { continuesAuthchain, isIdentityMarker, isP2pkh } from "src/utils/tools/identityDetection";

type Network = 'mainnet' | 'chipnet';

// What the detectors read of a transaction, which a history item carries too. Inputs have their
// outpoint only, except the token of input 1, the AuthKey an AuthGuard spend opens with
export interface ScannedTransaction {
  hash: string;
  inputs: Pick<InOutput, 'outpointTransactionHash' | 'outpointIndex' | 'token'>[];
  outputs: Pick<InOutput, 'lockingBytecode' | 'token'>[];
}

export interface TransactionIndex {
  // markers and the links after them, which identity detection walks
  identityChain: ScannedTransaction[];
  announcements: ScannedTransaction[];
  // every txid of the history, which tells a genesis from a token passed on
  historyTxids: ReadonlySet<string>;
}

// Raised when what is kept changes, so an index written by an earlier version is scanned again
const INDEX_VERSION = 3;
// Blocks below the last scan scanned again, so a reorg that shallow sorts itself out
const REORG_DEPTH = 10;
// Raw transactions fetched at once where the cache misses, as a history load does
const SCAN_CONCURRENCY = 32;
// Transactions decoded between yields to the event loop, so a first scan never holds the main
// thread for long
const DECODE_SLICE = 50;
// Largest index kept, in characters of JSON: a wallet that minted thousands from its authhead
// scans at every open instead, rather than crowding reservations out of localStorage
const MAX_STORED_INDEX = 512 * 1024;

interface StoredIndex {
  version: number;
  scannedHeight: number;
  // the history's confirmed transactions at or below scannedHeight - REORG_DEPTH: another count
  // means old transactions came or went (a deeper reorg, addresses found late), so all is scanned
  settledCount: number;
  identityChain: ScannedTransaction[];
  announcements: ScannedTransaction[];
}

function indexKey(network: Network, walletName: string) {
  return `transactionIndex-${network}-${walletName}`;
}

function loadIndex(network: Network, walletName: string): StoredIndex | undefined {
  const stored = localStorage.getItem(indexKey(network, walletName));
  if (!stored) return undefined;
  try {
    // token amounts are stored as strings, JSON having no bigint
    const index = JSON.parse(stored, (key, value) => key === 'amount' && typeof value === 'string' ? BigInt(value) : value) as StoredIndex;
    return index.version === INDEX_VERSION ? index : undefined;
  } catch {
    return undefined;
  }
}

// A full localStorage loses the index, not the result: the next open scans again
function saveIndex(network: Network, walletName: string, index: StoredIndex) {
  try {
    const json = JSON.stringify(index, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (json.length > MAX_STORED_INDEX) {
      // no stale copy left behind to be trusted at the next open
      localStorage.removeItem(indexKey(network, walletName));
      return;
    }
    localStorage.setItem(indexKey(network, walletName), json);
  } catch (error) {
    console.error("Failed to keep the transaction index:", error);
  }
}

// A future wallet created under the same name must not inherit the old wallet's index
export function removeTransactionIndex(walletName: string) {
  localStorage.removeItem(indexKey('mainnet', walletName));
  localStorage.removeItem(indexKey('chipnet', walletName));
}

// Clearing the cached history clears what was read off it too
export function removeAllTransactionIndexes() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('transactionIndex-')) localStorage.removeItem(key);
  }
}

function toToken(token: NonNullable<TransactionCommon['outputs'][number]['token']>): TokenI {
  return {
    category: toHex(token.category),
    amount: token.amount,
    ...(token.nft ? { nft: { capability: token.nft.capability, commitment: toHex(token.nft.commitment) } } : {}),
  };
}

function decoded(hash: string, hex: string) {
  const transaction = decodeTransaction(hexToBin(hex));
  if (typeof transaction === "string") throw new Error(`Transaction ${hash} does not decode: ${transaction}`);
  return transaction;
}

// Inputs 0 and 1 where they are, and of the rest those spending an output 0, the only ones the
// detectors look at; outputs 0 and 1 where they are, and of the rest the OP_RETURNs and the first
// output of each token category, so a genesis airdropping to hundreds keeps one
function scanTransaction(hash: string, hex: string): ScannedTransaction {
  const transaction = decoded(hash, hex);
  const inputs = transaction.inputs
    .filter((input, index) => index < 2 || input.outpointIndex === 0)
    .map(input => ({ outpointTransactionHash: toHex(input.outpointTransactionHash), outpointIndex: input.outpointIndex }));
  const categories = new Set<string>();
  const outputs: ScannedTransaction['outputs'] = [];
  transaction.outputs.forEach((output, index) => {
    const token = output.token ? toToken(output.token) : undefined;
    const firstOfCategory = token !== undefined && !categories.has(token.category);
    if (token) categories.add(token.category);
    if (index >= 2 && !firstOfCategory && output.lockingBytecode[0] !== Opcodes.OP_RETURN) return;
    outputs.push({ lockingBytecode: toHex(output.lockingBytecode), ...(token ? { token } : {}) });
  });
  return { hash, inputs, outputs };
}

interface IndexedWallet {
  getRawHistory(): Promise<TxI[]>;
  provider: { getRawTransactions(hashes: string[], options?: { concurrency?: number }): Promise<Map<string, string>> };
}

// Unconfirmed first, then newest first, as the history lists them: the order detection reads
// markers in
function historyOrder(a: TxI, b: TxI) {
  const aPending = a.height <= 0;
  const bPending = b.height <= 0;
  if (aPending && !bPending) return -1;
  if (bPending && !aPending) return 1;
  if (aPending) return a.height - b.height;
  return b.height - a.height;
}

function byHistoryOrder(rawHistory: TxI[]) {
  const position = new Map([...rawHistory].sort(historyOrder).map((tx, index) => [tx.tx_hash, index]));
  return (a: ScannedTransaction, b: ScannedTransaction) => (position.get(a.hash) ?? 0) - (position.get(b.hash) ?? 0);
}

function settledCount(rawHistory: TxI[], height: number) {
  return rawHistory.filter(tx => tx.height > 0 && tx.height <= height).length;
}

function yieldToEventLoop() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Brings the stored index up to the wallet's history and returns it. The raw transactions come from
// the provider, which reads them from its cache where the history load already put them.
export async function updateTransactionIndex(wallet: IndexedWallet, network: Network, walletName: string): Promise<TransactionIndex> {
  const rawHistory = await wallet.getRawHistory();
  const historyTxids = new Set(rawHistory.map(tx => tx.tx_hash));

  let stored = loadIndex(network, walletName);
  if (stored && settledCount(rawHistory, stored.scannedHeight - REORG_DEPTH) !== stored.settledCount) stored = undefined;
  const boundary = stored ? stored.scannedHeight - REORG_DEPTH : 0;
  // a transaction that left the history (a reorg, a replaced unconfirmed one) leaves the index
  const identityChain = new Map((stored?.identityChain ?? []).filter(tx => historyTxids.has(tx.hash)).map(tx => [tx.hash, tx]));
  const announcements = new Map((stored?.announcements ?? []).filter(tx => historyTxids.has(tx.hash)).map(tx => [tx.hash, tx]));

  const toScan = rawHistory
    .filter(tx => (tx.height <= 0 || tx.height > boundary) && !identityChain.has(tx.tx_hash) && !announcements.has(tx.tx_hash))
    .map(tx => tx.tx_hash);
  // one sliding fan-out for all of them; the hex stays until the chain is followed, which reads
  // its links from here rather than asking again
  let hexes = new Map<string, string>();
  if (toScan.length) hexes = await wallet.provider.getRawTransactions(toScan, { concurrency: SCAN_CONCURRENCY });
  // the spender of each output 0 among the transactions scanned, for following a chain into them
  const spenders = new Map<string, string>();
  const markers: ScannedTransaction[] = [];
  for (let start = 0; start < toScan.length; start += DECODE_SLICE) {
    if (start > 0) await yieldToEventLoop();
    for (const hash of toScan.slice(start, start + DECODE_SLICE)) {
      const transaction = scanTransaction(hash, hexes.get(hash)!);
      for (const input of transaction.inputs) {
        if (input.outpointIndex === 0) spenders.set(input.outpointTransactionHash!, hash);
      }
      if (isIdentityMarker(transaction, historyTxids)) {
        identityChain.set(hash, transaction);
        markers.push(transaction);
      }
      // both announce at output 0 or 1, and read nothing else
      if (listingOffer(transaction) || hodlAnnouncement(transaction)) {
        announcements.set(hash, { hash, inputs: [], outputs: transaction.outputs.slice(0, 2) });
      }
    }
  }

  // A covenant's spend continues the chain only when its input 1 holds the AuthKey, a token the
  // outpoint alone does not tell, so it is read off the transaction that created that input: from
  // the scan's own hex where the history holds it, else asked for, all at once
  async function withInput1Tokens(transactions: ScannedTransaction[]) {
    const needing = transactions.filter(transaction => transaction.inputs[1]?.outpointTransactionHash && !transaction.inputs[1].token);
    const missing = [...new Set(needing.map(transaction => transaction.inputs[1]!.outpointTransactionHash!))].filter(hash => !hexes.has(hash));
    let fetched = new Map<string, string>();
    if (missing.length) fetched = await wallet.provider.getRawTransactions(missing, { concurrency: SCAN_CONCURRENCY });
    for (const transaction of needing) {
      const input = transaction.inputs[1]!;
      const parentHash = input.outpointTransactionHash!;
      const parentHex = hexes.get(parentHash) ?? fetched.get(parentHash);
      if (!parentHex) continue;
      const token = decoded(parentHash, parentHex).outputs[input.outpointIndex!]?.token;
      if (token) transaction.inputs[1] = { ...input, token: toToken(token) };
    }
  }
  // every marker, not only the links followed: a publishing AuthGuard spend is a marker too
  await withInput1Tokens(markers);

  // the links after a marker or a kept link that the scanned transactions took the chain on to
  let frontier = [...identityChain.values()];
  while (frontier.length) {
    const candidates: { output0Bytecode: string, spender: ScannedTransaction }[] = [];
    for (const link of frontier) {
      const spenderTxid = spenders.get(link.hash);
      const output0Bytecode = link.outputs[0]?.lockingBytecode;
      if (!spenderTxid || !output0Bytecode || identityChain.has(spenderTxid)) continue;
      candidates.push({ output0Bytecode, spender: scanTransaction(spenderTxid, hexes.get(spenderTxid)!) });
    }
    await withInput1Tokens(candidates.filter(({ output0Bytecode }) => !isP2pkh(output0Bytecode)).map(({ spender }) => spender));
    const next: ScannedTransaction[] = [];
    for (const { output0Bytecode, spender } of candidates) {
      if (!continuesAuthchain(output0Bytecode, spender)) continue;
      identityChain.set(spender.hash, spender);
      next.push(spender);
    }
    frontier = next;
  }

  const order = byHistoryOrder(rawHistory);
  const index = {
    identityChain: [...identityChain.values()].sort(order),
    announcements: [...announcements.values()].sort(order),
  };
  let scannedHeight = stored?.scannedHeight ?? 0;
  for (const tx of rawHistory) {
    if (tx.height > scannedHeight) scannedHeight = tx.height;
  }
  saveIndex(network, walletName, {
    version: INDEX_VERSION,
    scannedHeight,
    settledCount: settledCount(rawHistory, scannedHeight - REORG_DEPTH),
    ...index,
  });
  return { ...index, historyTxids };
}
