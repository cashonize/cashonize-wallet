import type { TransactionHistoryItem } from "@cashonize/bch-wallet-lib";

// The loaded history brought up to date with a fresh load of its newest page, both newest first.
// The page replaces the items it holds, so their confirmations update, and puts new ones in front;
// an item the wallet's history no longer has (a replaced unconfirmed transaction) is dropped. The
// older items stay as loaded: each one's balance is the balance after it, which nothing later changes.
export function mergeNewestPage(
  loaded: readonly TransactionHistoryItem[],
  page: readonly TransactionHistoryItem[],
  historyTxids: ReadonlySet<string>,
): TransactionHistoryItem[] {
  const pageHashes = new Set(page.map(item => item.hash));
  const older = loaded.filter(item => !pageHashes.has(item.hash) && historyTxids.has(item.hash));
  return [...page, ...older];
}
