import { OpReturnData, type InOutput, type TransactionHistoryItem } from "@cashonize/bch-wallet-lib";
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
