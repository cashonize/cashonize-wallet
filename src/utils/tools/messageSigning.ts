import { HDWallet, SignedMessage } from "mainnet-js";
import { toPlainAddress } from "src/utils/addressValidation";
import type { WalletType } from "src/interfaces/interfaces";

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
