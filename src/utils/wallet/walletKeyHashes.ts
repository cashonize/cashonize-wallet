// The public key hashes a contract the portfolio looks for can be owned by. Contracts take their
// owner as a key hash, so these are what a manifest's owner is matched against or built from.

import {
  decodeCashAddress,
  binToHex,
  hash160,
  deriveSeedFromBip39Mnemonic,
  deriveHdPrivateNodeFromSeed,
  deriveHdPath,
  deriveHdPublicNode,
  deriveHdPublicNodeChild,
} from "@bitauth/libauth";

// Chain index of the HD wallet's dapp chain, shared with dapps over WizardConnect as 'defi'.
// A dapp creating a pool owns it with a key on this chain, so pools made through WizardConnect
// belong to addresses the wallet itself never hands out and never has history for.
const DEFI_CHAIN_INDEX = 7;

// Public key hashes of the first 'count' addresses on the wallet's dapp chain. Derived through
// the chain's public node, so no private keys for these addresses are created along the way.
// The libauth derivation functions throw on invalid input rather than returning an error.
export function defiChainPublicKeyHashes(mnemonic: string, parentDerivation: string, count: number): string[] {
  const seed = deriveSeedFromBip39Mnemonic(mnemonic);
  const chainNode = deriveHdPath(deriveHdPrivateNodeFromSeed(seed), `${parentDerivation}/${DEFI_CHAIN_INDEX}`);
  const chainPublicNode = deriveHdPublicNode(chainNode);

  const publicKeyHashes: string[] = [];
  for (let index = 0; index < count; index++) {
    const addressNode = deriveHdPublicNodeChild(chainPublicNode, index);
    publicKeyHashes.push(binToHex(hash160(addressNode.publicKey)));
  }
  return publicKeyHashes;
}

export function publicKeyHashFromAddress(address: string): string | undefined {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === "string") return undefined;
  return binToHex(decoded.payload);
}
