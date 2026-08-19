import { isBelowRelayFee, feeRate } from "../src/utils/history/txFeeRate";
import type { TransactionHistoryItem } from "mainnet-js";

// the base transaction is pending: no timestamp, and height 0 for the mempool
const makeTx = (overrides: Partial<TransactionHistoryItem>): TransactionHistoryItem => ({
  hash: "txhash123",
  blockHeight: 0,
  size: 250,
  fee: 300,
  balance: 150_000_000,
  valueChange: -50_000_000,
  inputs: [],
  outputs: [],
  tokenAmountChanges: [],
  ...overrides,
});

describe('isBelowRelayFee', () => {
  it('should not flag a pending transaction paying above the relay fee', () => {
    expect(isBelowRelayFee(makeTx({ size: 250, fee: 300 }))).toBe(false);
  });

  it('should flag a pending transaction paying below the relay fee', () => {
    expect(isBelowRelayFee(makeTx({ size: 250, fee: 240 }))).toBe(true);
  });

  it('should not flag a transaction paying exactly the relay fee', () => {
    expect(isBelowRelayFee(makeTx({ size: 250, fee: 250 }))).toBe(false);
  });

  it('should flag a transaction one satoshi under the relay fee', () => {
    expect(isBelowRelayFee(makeTx({ size: 250, fee: 249 }))).toBe(true);
  });

  it('should not flag a confirmed transaction, however low its fee', () => {
    const tx = makeTx({ size: 250, fee: 10, blockHeight: 800_000, timestamp: 1700000000 });
    expect(isBelowRelayFee(tx)).toBe(false);
  });

  it('should not flag a transaction of unknown size', () => {
    expect(isBelowRelayFee(makeTx({ size: 0, fee: 0 }))).toBe(false);
  });

  it('should flag a transaction chained on an unconfirmed parent', () => {
    // electrum reports height -1 for mempool transactions spending unconfirmed inputs,
    // both warnings apply to it independently
    expect(isBelowRelayFee(makeTx({ blockHeight: -1, size: 250, fee: 100 }))).toBe(true);
  });
});

describe('feeRate', () => {
  it('should report the rate in satoshis per byte', () => {
    expect(feeRate(makeTx({ size: 250, fee: 240 }))).toBe(0.96);
  });
});
