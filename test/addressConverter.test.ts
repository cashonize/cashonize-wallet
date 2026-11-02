import { Base58AddressFormatVersion, encodeBase58AddressFormat, encodeCashAddress, hexToBin } from "@bitauth/libauth";
import { convertAddress } from "../src/utils/tools/addressConverter";

// The CashAddr spec's published test vectors, one hash160 as P2PKH and as P2SH20
const hash160 = "76a04053bda0a88bda5177b86a15c3b29f559873";
const p2pkhLegacy = "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu";
const p2pkhCashAddress = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
const p2shLegacy = "3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC";
const p2shCashAddress = "bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq";
// the same hash's token-aware form, from the CHIP-CashTokens test vectors
const p2pkhTokenAddress = "bitcoincash:zpm2qsznhks23z7629mms6s4cwef74vcwvrqekrq9w";
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
      networkAssumed: false,
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
      expect(convertAddress(input, "bitcoincash")).toEqual({ ...expected, networkAssumed: input === p2pkhBytecode });
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
    // and read back from that bytecode
    expect(convertAddress(`aa20${"11".repeat(32)}87`, "bitcoincash")?.cashAddress).toBe(address);
  });

  it("keeps a chipnet address on its network, legacy form included", () => {
    const address = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload: hexToBin(hash160) }).address;
    const testnetLegacy = encodeBase58AddressFormat(Base58AddressFormatVersion.p2pkhTestnet, hexToBin(hash160));
    // without its prefix too: only the network it was made for passes the checksum
    for (const input of [address, testnetLegacy, address.split(":")[1]!]) {
      const converted = convertAddress(input, "bitcoincash");
      expect(converted?.prefix).toBe("bchtest");
      expect(converted?.cashAddress).toBe(address);
      expect(converted?.legacyAddress).toBe(testnetLegacy);
    }
    const p2shTestnetLegacy = encodeBase58AddressFormat(Base58AddressFormatVersion.p2sh20Testnet, hexToBin(hash160));
    expect(convertAddress(p2shTestnetLegacy, "bitcoincash")?.cashAddress)
      .toBe(encodeCashAddress({ prefix: "bchtest", type: "p2sh", payload: hexToBin(hash160) }).address);
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
    // a Copay legacy address, and a P2PK script, which has no address form
    expect(convertAddress(encodeBase58AddressFormat(Base58AddressFormatVersion.p2pkhCopayBCH, hexToBin(hash160)), "bitcoincash")).toBeUndefined();
    expect(convertAddress(`21${"02".repeat(33)}ac`, "bitcoincash")).toBeUndefined();
    // a WIF key is base58 too, but not an address
    expect(convertAddress("KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn", "bitcoincash")).toBeUndefined();
  });
});
