import type { TransactionHistoryItem } from "@cashonize/bch-wallet-lib";
import { mergeNewestPage } from "../src/utils/history/historyMerge";

const item = (hash: string, blockHeight: number, balance = 0): TransactionHistoryItem => ({
  hash, blockHeight, balance, timestamp: 0, size: 250, fee: 300, valueChange: 0, inputs: [], outputs: [], tokenAmountChanges: [],
});

describe("mergeNewestPage", () => {
  it("puts new items in front, updates the ones the page holds and keeps the older ones", () => {
    const loaded = [item("b", 0, 20), item("a", 100, 10)];
    const page = [item("c", 0, 30), item("b", 101, 20)];

    const merged = mergeNewestPage(loaded, page, new Set(["a", "b", "c"]));

    expect(merged.map(tx => [tx.hash, tx.blockHeight])).toEqual([["c", 0], ["b", 101], ["a", 100]]);
  });

  it("drops an item the wallet's history no longer has", () => {
    const loaded = [item("replaced", 0), item("b", 101), item("a", 100)];
    const page = [item("b", 101)];

    const merged = mergeNewestPage(loaded, page, new Set(["a", "b"]));

    expect(merged.map(tx => tx.hash)).toEqual(["b", "a"]);
  });
});
