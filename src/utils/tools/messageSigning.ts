import { HDWallet, SignedMessage } from "@cashonize/bch-wallet-lib";
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

// Check a message signature against the address it claims to be signed with. The library
// compares the address by its decoded payload, so an uppercase cashaddr (as QR codes typically
// encode) matches, and a malformed signature or address fails verification rather than throwing.
export function verifyMessage(message: string, address: string, signature: string): boolean {
  return SignedMessage.verify(message, signature, address).valid;
}
