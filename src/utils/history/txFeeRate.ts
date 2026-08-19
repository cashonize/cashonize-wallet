import type { TransactionHistoryItem } from "mainnet-js";

// Nodes relay transactions at 1 sat/byte by default, below that a transaction is
// non-standard and may sit unmined indefinitely. This is node policy, not consensus.
export const minRelayFeeRate = 1;

// Transactions pay 1 sat/byte, so 20 times that is no longer a margin a dapp added to
// its own size estimate, it is a mistake or an attempt to burn the fee
export const excessiveFeeRate = 20;

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
