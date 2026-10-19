import { encodeCashAddress, hexToBin } from "@bitauth/libauth";
import {
  getCashAddressScanError,
  validateRecipientAddress,
  validateTokenRecipientAddress,
} from "../src/utils/payments/recipientAddress";

// One payload in every form a user might paste: plain and token-aware, on both networks
const payload = hexToBin("9402f4bd3c3c97b20fde8e937ecd4c32a448ee0a");
const plainAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload }).address;
const tokenAddress = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkhWithTokens", payload }).address;
const testnetAddress = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload }).address;
const testnetTokenAddress = encodeCashAddress({ prefix: "bchtest", type: "p2pkhWithTokens", payload }).address;

describe("validateRecipientAddress", () => {
  it("returns a valid address on the wallet's network unchanged", () => {
    expect(validateRecipientAddress(plainAddress, "bitcoincash")).toBe(plainAddress);
    expect(validateRecipientAddress(tokenAddress, "bitcoincash")).toBe(tokenAddress);
  });

  it("adds the network prefix to an address written without one", () => {
    const withoutPrefix = plainAddress.split(":")[1]!;
    expect(validateRecipientAddress(withoutPrefix, "bitcoincash")).toBe(plainAddress);
    expect(validateRecipientAddress(`  ${plainAddress}  `, "bitcoincash")).toBe(plainAddress);
  });

  it("refuses an address of the other network", () => {
    expect(() => validateRecipientAddress(testnetAddress, "bitcoincash")).toThrow("Not a cashaddress on current network");
    expect(() => validateRecipientAddress(plainAddress, "bchtest")).toThrow("Not a cashaddress on current network");
  });

  it("refuses an address whose checksum does not match", () => {
    const lastChar = plainAddress.at(-1) === "q" ? "p" : "q";
    const corrupted = plainAddress.slice(0, -1) + lastChar;
    expect(() => validateRecipientAddress(corrupted, "bitcoincash")).toThrow("Invalid BCH address provided");
  });

  it("refuses a mainnet payload under the testnet prefix, since the checksum covers the prefix", () => {
    const withoutPrefix = plainAddress.split(":")[1]!;
    expect(() => validateRecipientAddress(withoutPrefix, "bchtest")).toThrow("Invalid BCH address provided");
  });

  it("refuses an empty destination", () => {
    expect(() => validateRecipientAddress("", "bitcoincash")).toThrow("No destination address provided");
  });
});

describe("validateTokenRecipientAddress", () => {
  it("accepts a token-aware address", () => {
    expect(validateTokenRecipientAddress(tokenAddress, "bitcoincash")).toBe(tokenAddress);
    expect(validateTokenRecipientAddress(testnetTokenAddress, "bchtest")).toBe(testnetTokenAddress);
  });

  it("refuses a plain address, which does not signal the recipient's wallet handles tokens", () => {
    expect(() => validateTokenRecipientAddress(plainAddress, "bitcoincash")).toThrow("Not a Token Address");
  });

  it("checks the network before the address type", () => {
    expect(() => validateTokenRecipientAddress(testnetTokenAddress, "bitcoincash")).toThrow("Not a cashaddress on current network");
  });
});

describe("getCashAddressScanError", () => {
  it("accepts a scanned address or payment URI on the wallet's network", () => {
    expect(getCashAddressScanError(plainAddress, "bitcoincash")).toBeUndefined();
    expect(getCashAddressScanError(`${tokenAddress}?amount=0.1`, "bitcoincash")).toBeUndefined();
  });

  it("refuses a scan from the other network", () => {
    expect(getCashAddressScanError(testnetAddress, "bitcoincash")).toBe("Not a cashaddress on current network");
    expect(getCashAddressScanError(`${testnetAddress}?amount=0.1`, "bitcoincash")).toBe("Not a cashaddress on current network");
  });

  it("refuses a scan that is not a cashaddr at all", () => {
    expect(getCashAddressScanError("https://example.com", "bitcoincash")).toBe("Not a cashaddress on current network");
  });
});
