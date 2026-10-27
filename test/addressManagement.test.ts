import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  deriveFreshAddressIndex,
  loadFrozenAddresses,
  saveFrozenAddress,
  deleteFrozenAddress,
  removeAddressManagementData,
} from "../src/utils/wallet/addressManagement";

// Addresses are identified by index ("addr0", "addr1", ...) so marks can be
// expressed as indices; usedIndices simulates on-chain history per address
const derive = (usedIndices: number[], markedIndices: number[], gapSize = 20) =>
  deriveFreshAddressIndex(
    (index) => usedIndices.includes(index),
    (index) => `addr${index}`,
    markedIndices.map((index) => `addr${index}`),
    gapSize,
  );

describe("deriveFreshAddressIndex", () => {
  it("returns the first unused address when nothing is marked", () => {
    expect(derive([], [])).toBe(0);
    expect(derive([0, 1, 2], [])).toBe(3);
  });

  it("returns the first hole in on-chain usage, like the wallet's own default", () => {
    expect(derive([0, 1, 3, 5], [])).toBe(2);
  });

  it("skips marked addresses", () => {
    expect(derive([], [0])).toBe(1);
    expect(derive([0, 1], [2, 3])).toBe(4);
  });

  it("skips a marked hole and lands on the next fresh address", () => {
    expect(derive([0, 1, 3], [2])).toBe(4);
  });

  it("marks and on-chain usage combine independently", () => {
    expect(derive([1, 3], [0, 2])).toBe(4);
  });

  it("returns undefined when every address in the discovery window is marked", () => {
    // window is [0, gapSize) since the first on-chain-unused address is 0
    expect(derive([], [0, 1, 2], 3)).toBeUndefined();
  });

  it("anchors the discovery window at the last on-chain-used address", () => {
    // last used is 4, so with gapSize 3 the last safe index is 7
    expect(derive([0, 1, 2, 3, 4], [5, 6], 3)).toBe(7);
    expect(derive([0, 1, 2, 3, 4], [5, 6, 7], 3)).toBeUndefined();
  });

  it("never returns an index the seed-restore scan would miss", () => {
    // 19 marked addresses on a wallet without history: index 19 is the last one
    // inside the 20-address gap, a 20th mark must leave nothing to hand out
    const nineteenMarks = Array.from({ length: 19 }, (_, i) => i);
    expect(derive([], nineteenMarks)).toBe(19);
    expect(derive([], [...nineteenMarks, 19])).toBeUndefined();
  });

  it("usage extends the window, like the seed-restore scan", () => {
    // last used is 2, so with gapSize 5 the last safe index is 7
    expect(derive([1, 2], [0, 3, 4], 5)).toBe(5);
    expect(derive([1, 2], [0, 3, 4, 5, 6, 7], 5)).toBeUndefined();
  });

  // Marks are only cleared by the user, so a marked address never gains on-chain history
  // to move the window along. Payments have to do that, or the window fills up for good.
  it("a payment frees up fresh addresses again", () => {
    // the user marked every address they could, then the payment arrived on the last one
    const nineteenMarks = Array.from({ length: 19 }, (_, i) => i);
    expect(derive([19], nineteenMarks)).toBe(20);

    // the user marked address 0 once, then received 19 payments without marking again
    const nineteenPayments = Array.from({ length: 19 }, (_, i) => i + 1);
    expect(derive(nineteenPayments, [0])).toBe(20);
  });
});

// The global setup stubs localStorage as a no-op; these tests need a working store
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

describe("frozen addresses", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  it("saves and loads them per wallet per network", () => {
    saveFrozenAddress("mainnet", "mywallet", "bitcoincash:qa");
    expect(loadFrozenAddresses("mainnet", "mywallet")).toEqual(["bitcoincash:qa"]);
    expect(loadFrozenAddresses("chipnet", "mywallet")).toEqual([]);
    expect(loadFrozenAddresses("mainnet", "otherwallet")).toEqual([]);
  });

  it("re-reads before writing, so a freeze from another tab survives", () => {
    saveFrozenAddress("mainnet", "mywallet", "bitcoincash:qa");
    localStorage.setItem("frozenAddresses-mainnet-mywallet", JSON.stringify(["bitcoincash:qa", "bitcoincash:qb"]));
    expect(deleteFrozenAddress("mainnet", "mywallet", "bitcoincash:qa")).toEqual(["bitcoincash:qb"]);
  });

  it("is removed with the wallet, so a new wallet of the same name starts unfrozen", () => {
    saveFrozenAddress("mainnet", "mywallet", "bitcoincash:qa");
    saveFrozenAddress("chipnet", "mywallet", "bchtest:qa");
    removeAddressManagementData("mywallet");
    expect(loadFrozenAddresses("mainnet", "mywallet")).toEqual([]);
    expect(loadFrozenAddresses("chipnet", "mywallet")).toEqual([]);
  });
});
