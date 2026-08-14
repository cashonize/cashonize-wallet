import type { TransactionHistoryItem } from "mainnet-js";

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

export function directionIcon(transaction: TransactionHistoryItem): string {
  // pending transactions show a waiting icon, the label next to it carries the direction
  if (!transaction.timestamp) return 'hourglass_empty';
  const direction = txDirection(transaction);
  if (direction === 'combined') return 'swap_vert';
  return direction === 'received' ? 'arrow_downward' : 'arrow_upward';
}

// A transaction the wallet coauthored that also spends a contract (P2SH) input is
// a dapp interaction. Requiring one of the wallet's own inputs filters out third
// parties that merely pay us from a P2SH wallet, like exchange withdrawals
export function isDappInteraction(
  transaction: TransactionHistoryItem,
  hasWalletAddress: (address: string) => boolean
): boolean {
  const hasP2shInput = transaction.inputs.some(input => {
    // P2SH cashaddr payloads start with p, or r for the token-aware variant
    const payload = input.address.split(":")[1] ?? "";
    return payload.startsWith("p") || payload.startsWith("r");
  });
  if (!hasP2shInput) return false;
  return transaction.inputs.some(input => hasWalletAddress(input.address));
}
