// The AuthGuard standard (https://github.com/mr-zwets/AuthGuard): an identity's authhead locked
// in a covenant, with the authority to spend it tokenized as an "AuthKey" NFT.
//
// The covenant's script is determined by the AuthKey's category, so a guarded identity is recognised
// the way the standard verifies one: derive the locking bytecode and compare. Every mention of
// the script lives here; the resolve in authchainIdentity.ts reads it.

import type { Utxo } from "mainnet-js";
import {
  binToHex,
  encodeLockingBytecodeP2sh20,
  encodeLockingBytecodeP2sh32,
  hash160,
  hash256,
  hexToBin,
} from "@bitauth/libauth";

// The compiled body of AuthGuard.cash: require the AuthKey at input 1, force output 0 back to the
// covenant. Recognised by its exact bytecode, so no CashScript tooling is needed to derive it.
const AUTHGUARD_BODY = "51ce8851d0009d6300cdc0c7886851";

// The covenant's redeem script for one AuthKey category. The category is byte-reversed because the
// script compares it against the transaction's own encoding of it, which is little-endian.
export function authGuardRedeemScript(category: string): Uint8Array {
  const reversedCategory = binToHex(hexToBin(category).reverse());
  return hexToBin(`20${reversedCategory}${AUTHGUARD_BODY}`);
}

// Both hash lengths a P2SH output can commit to, since deployments exist in both. A match at
// either is self-proving: spending the output means presenting this very redeem script, with
// this AuthKey's category already inside it.
export function authGuardLockingBytecodes(category: string): { p2sh20: string; p2sh32: string } {
  const redeemScript = authGuardRedeemScript(category);
  return {
    p2sh20: binToHex(encodeLockingBytecodeP2sh20(hash160(redeemScript))),
    p2sh32: binToHex(encodeLockingBytecodeP2sh32(hash256(redeemScript))),
  };
}

// Whether an identity output sits in the covenant this AuthKey category opens
export function isAuthGuardOf(keyCategory: string, lockingBytecode: string): boolean {
  const forms = authGuardLockingBytecodes(keyCategory);
  return lockingBytecode === forms.p2sh20 || lockingBytecode === forms.p2sh32;
}

// The commitment CashTokens Studio mints its AuthKeys with. The covenant reads none, so this is a
// convention, and the one thing that tells a Studio AuthKey from a collectible before its identity
// is resolved.
export const STUDIO_KEY_COMMITMENT = "00";

// The AuthKey the covenant asks for at input 1: a token of its category carrying no amount, which
// with a category of 32 bytes on the covenant's side means an NFT without capability. The
// contract reads no commitment, so any is one unless the caller knows which commitment was minted.
export function isAuthKey(utxo: Utxo, keyCategory: string, commitment?: string): boolean {
  const token = utxo.token;
  if (!token || token.category !== keyCategory) return false;
  if (token.amount !== 0n || token.nft?.capability !== "none") return false;
  return commitment === undefined || token.nft.commitment === commitment;
}

// The covenants the AuthKeys in this wallet open, by locking bytecode. A covenant's script follows
// from its AuthKey's category alone, so an AuthKey here derives the address its identity sits at,
// and a guard is recognised without the registry naming it. Built once per resolve.
export function guardsOpenedByHeldAuthKeys(walletUtxos: Utxo[]): Map<string, string> {
  const guards = new Map<string, string>();
  const derived: string[] = [];
  for (const utxo of walletUtxos) {
    const category = utxo.token?.category;
    if (!category || derived.includes(category) || !isAuthKey(utxo, category)) continue;
    derived.push(category);
    const { p2sh20, p2sh32 } = authGuardLockingBytecodes(category);
    guards.set(p2sh20, category);
    guards.set(p2sh32, category);
  }
  return guards;
}
