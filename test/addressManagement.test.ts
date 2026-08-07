import { describe, it, expect } from "vitest";
import { deriveFreshAddressIndex } from "../src/utils/addressManagement";

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

  it("anchors the discovery window at the first on-chain-unused address", () => {
    // first unused is 5, so with gapSize 3 the last safe index is 7
    expect(derive([0, 1, 2, 3, 4], [5, 6], 3)).toBe(7);
    expect(derive([0, 1, 2, 3, 4], [5, 6, 7], 3)).toBeUndefined();
  });

  it("never returns an index the seed-restore scan would miss", () => {
    // 19 marked fresh addresses from the first unused: index 19 is still inside
    // the 20-address gap; a 20th mark would push past it and must fail instead
    const nineteenMarks = Array.from({ length: 19 }, (_, i) => i);
    expect(derive([], nineteenMarks)).toBe(19);
    expect(derive([], [...nineteenMarks, 19])).toBeUndefined();
  });

  it("usage inside the window does not extend it", () => {
    // first unused is 0; addresses 1 and 2 being used on-chain does not move
    // the window anchor, so marks on 0 and 3 leave index 4 as the last option
    expect(derive([1, 2], [0, 3], 5)).toBe(4);
    expect(derive([1, 2], [0, 3, 4], 5)).toBeUndefined();
  });
});
