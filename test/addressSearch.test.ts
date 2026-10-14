import { encodeCashAddress } from "@bitauth/libauth";
import type { TransactionHistoryItem } from "mainnet-js";
import { addressQueryBytecode, labelledAddressBytecodes, txInvolvesBytecode } from "../src/utils/history/addressSearch";

const payload = new Uint8Array(20).fill(7);
const otherPayload = new Uint8Array(20).fill(9);
const address = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload }).address;
const tokenAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkhWithTokens", payload }).address;
const otherAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload: otherPayload }).address;
// OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
const p2pkhBytecode = (fill: string) => "76a914" + fill.repeat(20) + "88ac";
const bytecode = p2pkhBytecode("07");
const otherBytecode = p2pkhBytecode("09");

const makeTx = (overrides: Partial<TransactionHistoryItem>): TransactionHistoryItem => ({
  hash: "txhash123",
  blockHeight: 800000,
  timestamp: 1700000000,
  size: 250,
  fee: 300,
  balance: 0,
  valueChange: 0,
  inputs: [],
  outputs: [],
  tokenAmountChanges: [],
  ...overrides,
});

describe("addressQueryBytecode", () => {
  it("gives an address and its token-aware form the same bytecode", () => {
    expect(addressQueryBytecode(address)).toBe(bytecode);
    expect(addressQueryBytecode(tokenAddress)).toBe(bytecode);
  });

  it("accepts an address without its prefix", () => {
    expect(addressQueryBytecode(tokenAddress.split(":")[1]!)).toBe(bytecode);
  });

  it("is undefined for anything but a whole address", () => {
    expect(addressQueryBytecode(address.slice(0, -1))).toBeUndefined();
    expect(addressQueryBytecode("qz")).toBeUndefined();
    expect(addressQueryBytecode("my savings")).toBeUndefined();
  });
});

describe("txInvolvesBytecode", () => {
  it("matches the bytecode in an input or an output", () => {
    const spending = makeTx({ inputs: [{ address, value: 1000, lockingBytecode: bytecode }] });
    const paying = makeTx({ outputs: [{ address: tokenAddress, value: 1000, lockingBytecode: bytecode }] });
    expect(txInvolvesBytecode(spending, new Set([bytecode]))).toBe(true);
    expect(txInvolvesBytecode(paying, new Set([bytecode]))).toBe(true);
  });

  it("does not match other scripts or a coinbase input", () => {
    const tx = makeTx({
      inputs: [{ address: "coinbase", value: 312_500_000 }],
      outputs: [{ address: otherAddress, value: 1000, lockingBytecode: otherBytecode }],
    });
    expect(txInvolvesBytecode(tx, new Set([bytecode]))).toBe(false);
    expect(txInvolvesBytecode(tx, new Set())).toBe(false);
  });
});

describe("labelledAddressBytecodes", () => {
  it("returns the bytecode of every address whose label contains the query", () => {
    const labels = { [address]: "Savings", [otherAddress]: "Rent" };
    expect(labelledAddressBytecodes(labels, "sav")).toEqual([bytecode]);
    expect(labelledAddressBytecodes(labels, "e")).toEqual([otherBytecode]);
    expect(labelledAddressBytecodes(labels, "groceries")).toEqual([]);
  });
});
