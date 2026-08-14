import { txDirection, isCombined, isDappInteraction } from "../src/utils/history/txDirection";
import type { TransactionHistoryItem } from "mainnet-js";

const category = "aabbccdd".repeat(8);

const makeTx = (overrides: Partial<TransactionHistoryItem>): TransactionHistoryItem => ({
  hash: "txhash123",
  blockHeight: 800000,
  timestamp: 1700000000,
  size: 250,
  fee: 300,
  balance: 150_000_000,
  valueChange: -50_000_000,
  inputs: [],
  outputs: [],
  tokenAmountChanges: [],
  ...overrides,
});

const input = (address: string) => ({ address, value: 10_000 } as TransactionHistoryItem["inputs"][number]);

describe('txDirection', () => {
  it('should classify a plain BCH receive as received', () => {
    expect(txDirection(makeTx({ valueChange: 100_000 }))).toBe('received');
  });

  it('should classify a plain BCH send as sent', () => {
    expect(txDirection(makeTx({ valueChange: -100_000 }))).toBe('sent');
  });

  it('should classify a token receive with dust as received', () => {
    const tx = makeTx({ valueChange: 1000, tokenAmountChanges: [{ category, amount: 5n, nftAmount: 0n }] });
    expect(txDirection(tx)).toBe('received');
  });

  it('should classify a token send paying the fee as sent', () => {
    const tx = makeTx({ valueChange: -500, tokenAmountChanges: [{ category, amount: -5n, nftAmount: 0n }] });
    expect(txDirection(tx)).toBe('sent');
  });

  it('should classify BCH in with tokens out as combined', () => {
    const tx = makeTx({ valueChange: 349_321_793, tokenAmountChanges: [{ category, amount: -540n, nftAmount: -1n }] });
    expect(txDirection(tx)).toBe('combined');
    expect(isCombined(tx)).toBe(true);
  });

  it('should classify BCH out with tokens in as combined', () => {
    const tx = makeTx({ valueChange: -1000, tokenAmountChanges: [{ category, amount: 0n, nftAmount: 1n }] });
    expect(txDirection(tx)).toBe('combined');
  });

  it('should classify a token for token trade as combined', () => {
    const tx = makeTx({ valueChange: -500, tokenAmountChanges: [
      { category, amount: 10n, nftAmount: 0n },
      { category: "11223344".repeat(8), amount: -3n, nftAmount: 0n },
    ]});
    expect(txDirection(tx)).toBe('combined');
  });
});

describe('isDappInteraction', () => {
  const ownAddress = "bitcoincash:qq1234ownaddress";
  const hasWalletAddress = (address: string) => address === ownAddress;

  it('should detect a cosigned transaction spending a P2SH input', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:pp1234contract"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(true);
  });

  it('should detect the token-aware P2SH address variant', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:rr1234contract"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(true);
  });

  it('should not flag a third party paying from a P2SH wallet', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:pp1234exchange")] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });

  it('should not flag plain P2PKH transactions', () => {
    const tx = makeTx({ inputs: [input("bitcoincash:qq1234other"), input(ownAddress)] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });

  it('should handle the coinbase pseudo address', () => {
    const tx = makeTx({ inputs: [input("coinbase")] });
    expect(isDappInteraction(tx, hasWalletAddress)).toBe(false);
  });
});
