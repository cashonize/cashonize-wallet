import type { TransactionHistoryItem } from "mainnet-js";

// Nodes relay transactions at 1 sat/byte by default, below that a transaction is
// non-standard and may sit unmined indefinitely. This is node policy, not consensus.
export const minRelayFeeRate = 1;

export function feeRate(transaction: TransactionHistoryItem): number {
  return transaction.fee / transaction.size;
}

export function isBelowRelayFee(transaction: TransactionHistoryItem): boolean {
  // once mined the fee rate no longer says anything about the transaction
  if (transaction.timestamp) return false;
  if (!transaction.size) return false;
  // integer comparison, so a transaction paying exactly 1 sat/byte is never flagged
  return transaction.fee < transaction.size * minRelayFeeRate;
}
