import { csvEscape, historyToCsv } from "../src/utils/csvUtils";
import type { TransactionHistoryItem } from "mainnet-js";
import type { BcmrTokenMetadata } from "../src/interfaces/interfaces";

const categoryA = "aabbccdd".repeat(8);
const categoryB = "11223344".repeat(8);

const makeTx = (overrides: Partial<TransactionHistoryItem>): TransactionHistoryItem => ({
  hash: "txhash123",
  blockHeight: 800000,
  timestamp: 1700000000, // 2023-11-14T22:13:20.000Z
  size: 250,
  fee: 300,
  balance: 150_000_000,
  valueChange: -50_000_000,
  inputs: [],
  outputs: [],
  tokenAmountChanges: [],
  ...overrides,
});

const registries = {
  [categoryA]: { token: { symbol: "FURU", decimals: 2 } },
  [categoryB]: { token: { symbol: "=cmd|' /C calc'!A0", decimals: 0 } },
} as unknown as Record<string, BcmrTokenMetadata>;

describe('csvEscape', () => {
  it('should leave plain fields unchanged', () => {
    expect(csvEscape("plain text")).toBe("plain text");
  })
  it('should quote fields containing commas and escape embedded quotes', () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  })
})

describe('historyToCsv', () => {
  it('should write the header with the given BCH unit', () => {
    expect(historyToCsv([], undefined, "tBCH"))
      .toBe("Date (UTC),Transaction Id,Amount (tBCH),Balance (tBCH),Token Changes");
  })
  it('should format the date as ISO UTC and amounts with 8 decimals', () => {
    const csv = historyToCsv([makeTx({})], undefined, "BCH");
    expect(csv.split("\r\n")[1]).toBe("2023-11-14T22:13:20.000Z,txhash123,-0.50000000,1.50000000,");
  })
  it('should mark unconfirmed transactions as pending', () => {
    const pendingTx = makeTx({});
    delete pendingTx.timestamp;
    const csv = historyToCsv([pendingTx], undefined, "BCH");
    expect(csv).toContain("pending,txhash123");
  })
  it('should apply token symbol and decimals from the registry', () => {
    const tx = makeTx({ tokenAmountChanges: [{ category: categoryA, amount: 12345n, nftAmount: -1n }] });
    const csv = historyToCsv([tx], registries, "BCH");
    expect(csv).toContain("+123.45 FURU; -1 FURU NFT");
  })
  it('should fall back to the category prefix for unknown tokens', () => {
    const tx = makeTx({ tokenAmountChanges: [{ category: categoryA, amount: -5n, nftAmount: 0n }] });
    const csv = historyToCsv([tx], undefined, "BCH");
    expect(csv).toContain("-5 aabbccdd");
  })
  it('should strip formula-injection characters from token symbols', () => {
    const tx = makeTx({ tokenAmountChanges: [{ category: categoryB, amount: 1n, nftAmount: 0n }] });
    const csv = historyToCsv([tx], registries, "BCH");
    expect(csv).not.toContain("=cmd");
    expect(csv).not.toContain("|");
    expect(csv).toContain("+1 cmdCcalcA0");
  })
})
