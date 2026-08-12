import { HDWallet, SignedMessage } from "mainnet-js";
import { assertSuccess, decodeCashAddress, encodeCashAddress } from "@bitauth/libauth";
import type { WalletType } from "src/interfaces/interfaces";

// Wallet addresses are matched by their plain p2pkh form: the HD wallet cache and
// single-address wallets are keyed that way, so token-aware input still resolves.
function toPlainAddress(address: string): string {
  const decoded = assertSuccess(decodeCashAddress(address));
  return encodeCashAddress({ prefix: decoded.prefix, type: "p2pkh", payload: decoded.payload }).address;
}

// Resolve the private key controlling one of the wallet's own addresses.
// Expects a valid cashaddr; returns undefined when the address is not part of the wallet.
export function resolvePrivateKeyForAddress(wallet: WalletType, address: string): Uint8Array | undefined {
  const plainAddress = toPlainAddress(address);
  if (wallet instanceof HDWallet) {
    return wallet.walletCache.get(plainAddress)?.privateKey;
  }
  if (plainAddress !== wallet.cashaddr) return undefined;
  return wallet.privateKey;
}

// Check a message signature against the address it claims to be signed with.
// Never throws: a malformed signature or address simply fails verification.
export function verifyMessage(message: string, address: string, signature: string): boolean {
  try {
    // Uppercase cashaddrs (as QR codes typically encode) are valid, but SignedMessage.verify
    // compares the re-encoded lowercase address to the input with strict equality
    return SignedMessage.verify(message, signature, address.toLowerCase()).valid;
  } catch {
    return false;
  }
}
