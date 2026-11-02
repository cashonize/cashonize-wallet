import { Base58AddressFormatVersion, encodeBase58AddressFormat, encodeCashAddress, hexToBin } from "@bitauth/libauth";
import { convertAddress } from "../src/utils/tools/addressConverter";

// The CashAddr spec's published test vectors, one hash160 as P2PKH and as P2SH20
const hash160 = "76a04053bda0a88bda5177b86a15c3b29f559873";
const p2pkhLegacy = "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu";
const p2pkhCashAddress = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
const p2shLegacy = "3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC";
const p2shCashAddress = "bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq";
// the token-aware form is not in the spec, derived from the hash instead
const p2pkhTokenAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkhWithTokens", payload: hexToBin(hash160) }).address;
const p2pkhBytecode = `76a914${hash160}88ac`;

describe("convertAddress", () => {
  it("gives every form of a P2PKH address, whichever form it is read from", () => {
    const expected = {
      type: "P2PKH",
      prefix: "bitcoincash",
      cashAddress: p2pkhCashAddress,
      tokenAddress: p2pkhTokenAddress,
      legacyAddress: p2pkhLegacy,
      lockingBytecode: p2pkhBytecode,
    };
    const inputs = [
      p2pkhCashAddress,
      p2pkhTokenAddress,
      p2pkhLegacy,
      p2pkhBytecode,
      p2pkhCashAddress.split(":")[1]!,
      p2pkhCashAddress.toUpperCase().split(":")[1]!,
      `  ${p2pkhCashAddress}  `,
    ];
    for (const input of inputs) {
      expect(convertAddress(input, "bitcoincash")).toEqual(expected);
    }
  });

  it("reads a P2SH20 legacy address", () => {
    const converted = convertAddress(p2shLegacy, "bitcoincash");
    expect(converted?.type).toBe("P2SH20");
    expect(converted?.cashAddress).toBe(p2shCashAddress);
    expect(converted?.legacyAddress).toBe(p2shLegacy);
    expect(converted?.lockingBytecode).toBe(`a914${hash160}87`);
  });

  it("gives a P2SH32 address no legacy form", () => {
    const payload = hexToBin("11".repeat(32));
    const address = encodeCashAddress({ prefix: "bitcoincash", type: "p2sh", payload }).address;
    const converted = convertAddress(address, "bitcoincash");
    expect(converted?.type).toBe("P2SH32");
    expect(converted?.legacyAddress).toBeUndefined();
    expect(converted?.tokenAddress).toBe(encodeCashAddress({ prefix: "bitcoincash", type: "p2shWithTokens", payload }).address);
    expect(converted?.lockingBytecode).toBe(`aa20${"11".repeat(32)}87`);
  });

  it("keeps a chipnet address on its network, legacy form included", () => {
    const address = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload: hexToBin(hash160) }).address;
    const testnetLegacy = encodeBase58AddressFormat(Base58AddressFormatVersion.p2pkhTestnet, hexToBin(hash160));
    for (const input of [address, testnetLegacy]) {
      const converted = convertAddress(input, "bitcoincash");
      expect(converted?.prefix).toBe("bchtest");
      expect(converted?.cashAddress).toBe(address);
      expect(converted?.legacyAddress).toBe(testnetLegacy);
    }
    // a locking bytecode names no network, it is read on the active one
    expect(convertAddress(p2pkhBytecode, "bchtest")?.cashAddress).toBe(address);
  });

  it("refuses what is not an address", () => {
    expect(convertAddress("", "bitcoincash")).toBeUndefined();
    expect(convertAddress("hello world", "bitcoincash")).toBeUndefined();
    // a typo breaks the checksum
    expect(convertAddress(p2pkhCashAddress.slice(0, -1) + "b", "bitcoincash")).toBeUndefined();
    // OP_RETURN with a 4-byte push
    expect(convertAddress("6a0401020304", "bitcoincash")).toBeUndefined();
    // a WIF key is base58 too, but not an address
    expect(convertAddress("KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn", "bitcoincash")).toBeUndefined();
  });
});
