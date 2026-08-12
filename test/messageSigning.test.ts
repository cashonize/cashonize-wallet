import { Wallet, SignedMessage } from "mainnet-js";
import { resolvePrivateKeyForAddress, verifyMessage } from "../src/utils/messageSigning";

// same throwaway key as wcSigning.test.ts
const throwAwayTestKeyWif = 'L15RRkJJdgWARpbwHaZV4a99ciHhKEmWz8bR8aQ5T94FqhfAw3Ac'

const throwAwayWallet = await Wallet.fromWIF(throwAwayTestKeyWif);
const walletAddress = throwAwayWallet.cashaddr;
const walletTokenAddress = throwAwayWallet.getTokenDepositAddress();
const foreignAddress = "bitcoincash:qp63uahgrxged4z5jswyt5dn5v3lzsem6cy4spdc2h";

const testMessage = "Cashonize test message";

describe('resolvePrivateKeyForAddress', () => {
  it('should resolve the private key for the wallet address', () => {
    const privateKey = resolvePrivateKeyForAddress(throwAwayWallet, walletAddress);
    expect(privateKey).toEqual(throwAwayWallet.privateKey);
  })
  it('should resolve the private key for the token-aware form of the wallet address', () => {
    const privateKey = resolvePrivateKeyForAddress(throwAwayWallet, walletTokenAddress);
    expect(privateKey).toEqual(throwAwayWallet.privateKey);
  })
  it('should return undefined for an address not in the wallet', () => {
    const privateKey = resolvePrivateKeyForAddress(throwAwayWallet, foreignAddress);
    expect(privateKey).toBeUndefined();
  })
})

describe('verifyMessage', () => {
  it('should verify a signature round-trip, also against the token-aware address form', () => {
    const signature = SignedMessage.sign(testMessage, throwAwayWallet.privateKey).signature;
    expect(verifyMessage(testMessage, walletAddress, signature)).toBe(true);
    expect(verifyMessage(testMessage, walletTokenAddress, signature)).toBe(true);
  })
  it('should reject a tampered message and a different address', () => {
    const signature = SignedMessage.sign(testMessage, throwAwayWallet.privateKey).signature;
    expect(verifyMessage(testMessage + "!", walletAddress, signature)).toBe(false);
    expect(verifyMessage(testMessage, foreignAddress, signature)).toBe(false);
  })
  it('should return false instead of throwing on malformed input', () => {
    expect(verifyMessage(testMessage, walletAddress, "not-a-signature")).toBe(false);
    expect(verifyMessage(testMessage, "not-an-address", "SGVsbG8gd29ybGQ=")).toBe(false);
  })
  it('should keep producing the Electron Cash compatible signature encoding', () => {
    // Deterministic signatures (RFC 6979 nonces) make this a stable regression check
    // that mainnet-js upgrades don't change the message signing encoding
    const expectedSignature = "INJhauXYToTLNPfp/2L2c0VgGkLqAs+93B1cohELpMbWFNfVsca40MT9AoDYAV8f7SqmJ578uc9i1iLkFwQQJ0Y=";
    const signature = SignedMessage.sign(testMessage, throwAwayWallet.privateKey).signature;
    expect(signature).toEqual(expectedSignature);
    expect(verifyMessage(testMessage, walletAddress, expectedSignature)).toBe(true);
  })
})
