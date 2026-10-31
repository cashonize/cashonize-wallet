import { OpReturnData, type InOutput, type TransactionHistoryItem, type Utxo } from "@cashonize/bch-wallet-lib";
import { hexToBin } from "@bitauth/libauth";

export type TxDirection = 'received' | 'sent' | 'combined';

// Direction is judged per asset flow: the BCH change and every token change count
// separately. A transaction with flows both ways (a swap, loan or mint) is combined
export function txHasIncoming(transaction: TransactionHistoryItem): boolean {
  if (transaction.valueChange > 0) return true;
  return transaction.tokenAmountChanges.some(change => change.amount > 0n || change.nftAmount > 0n);
}

export function txHasOutgoing(transaction: TransactionHistoryItem): boolean {
  if (transaction.valueChange < 0) return true;
  return transaction.tokenAmountChanges.some(change => change.amount < 0n || change.nftAmount < 0n);
}

export function isCombined(transaction: TransactionHistoryItem): boolean {
  return txHasIncoming(transaction) && txHasOutgoing(transaction);
}

export function txDirection(transaction: TransactionHistoryItem): TxDirection {
  if (isCombined(transaction)) return 'combined';
  return txHasOutgoing(transaction) ? 'sent' : 'received';
}

// What a transaction paid the wallet from coins not its own, for the received notices. With an
// input of the wallet, what comes back to it is change, also of a send made elsewhere on the same
// keys. The satoshis are those of its BCH-only outputs: an NFT's dust is not BCH received.
export function receivedFromOthers(
  transaction: TransactionHistoryItem,
  hasWalletAddress: (address: string) => boolean
): { satoshis: bigint, tokenType: 'NFT' | 'tokens' | undefined } | undefined {
  if (transaction.inputs.some(input => hasWalletAddress(input.address))) return undefined;
  let satoshis = 0n;
  for (const output of transaction.outputs) {
    if (!output.token && hasWalletAddress(output.address)) satoshis += BigInt(output.value);
  }
  let tokenType: 'NFT' | 'tokens' | undefined;
  if (transaction.tokenAmountChanges.some(change => change.amount > 0n)) tokenType = 'tokens';
  if (transaction.tokenAmountChanges.some(change => change.nftAmount > 0n)) tokenType = 'NFT';
  return { satoshis, tokenType };
}

// One notice per transaction that brought new coins and paid the wallet from coins not its own,
// read from the refreshed history. A transaction's sats and its tokens each get one notice, not one
// per output. Adds what it looked at to announced, as an HD wallet's debounce can split one
// transaction's coins over two changes
export function receiptsToAnnounce(
  history: TransactionHistoryItem[],
  added: Utxo[],
  announced: Set<string>,
  hasWalletAddress: (address: string) => boolean
) {
  const newTxids = new Set(added.map(utxo => utxo.txid));
  const receipts: NonNullable<ReturnType<typeof receivedFromOthers>>[] = [];
  for (const transaction of history) {
    if (!newTxids.has(transaction.hash) || announced.has(transaction.hash)) continue;
    announced.add(transaction.hash);
    const received = receivedFromOthers(transaction, hasWalletAddress);
    if (received) receipts.push(received);
  }
  return receipts;
}

// A send that only moves coins between the wallet's own addresses, like a consolidation, costs
// the fee and nothing else. An OP_RETURN output pays no one, so it does not make a send external
export function isSelfSend(
  transaction: TransactionHistoryItem,
  hasWalletAddress: (address: string) => boolean
): boolean {
  if (txHasIncoming(transaction)) return false;
  if (transaction.tokenAmountChanges.some(change => change.amount !== 0n || change.nftAmount !== 0n)) return false;
  if (!transaction.inputs.every(input => hasWalletAddress(input.address))) return false;
  return transaction.outputs.every(output =>
    opReturnHex(output) !== undefined || hasWalletAddress(output.address)
  );
}

export function directionIcon(transaction: TransactionHistoryItem, selfSend = false): string {
  // pending transactions show a waiting icon, the label next to it carries the direction
  if (!transaction.timestamp) return 'hourglass_empty';
  if (selfSend) return 'sync';
  const direction = txDirection(transaction);
  if (direction === 'combined') return 'swap_vert';
  return direction === 'received' ? 'arrow_downward' : 'arrow_upward';
}

// A transaction the wallet coauthored that also spends a contract (P2SH or P2S) input is
// a dapp interaction. Requiring one of the wallet's own inputs filters out third
// parties that merely pay us from a P2SH wallet, like exchange withdrawals
export function isDappInteraction(
  transaction: TransactionHistoryItem,
  hasWalletAddress: (address: string) => boolean
): boolean {
  const hasContractInput = transaction.inputs.some(input => {
    if (input.address.startsWith(SCRIPT_ADDRESS_PREFIX)) return true;
    // P2SH cashaddr payloads start with p, or r for the token-aware variant
    const payload = input.address.split(":")[1] ?? "";
    return payload.startsWith("p") || payload.startsWith("r");
  });
  if (!hasContractInput) return false;
  return transaction.inputs.some(input => hasWalletAddress(input.address));
}

// What the library puts in place of the address of a coin that has none: a P2S contract, and the
// rarer P2PK and bare multisig
export const SCRIPT_ADDRESS_PREFIX = "SCRIPT: ";

// The locking bytecode of an OP_RETURN output, in hex, which is where the protocol announcements
// are read; undefined for any other output
export function opReturnHex(output: Pick<InOutput, 'lockingBytecode'> | undefined) {
  const lockingBytecode = output?.lockingBytecode;
  if (!lockingBytecode?.startsWith("6a")) return undefined;
  return lockingBytecode;
}

// The protocol announcements read here are a series of pushes after the OP_RETURN. Returns
// undefined for anything else, which for an announcement is a malformed one
export function opReturnChunks(announcementHex: string) {
  try {
    return OpReturnData.parseBinary(hexToBin(announcementHex));
  } catch {
    return undefined;
  }
}
