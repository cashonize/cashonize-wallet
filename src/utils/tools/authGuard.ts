// The AuthGuard standard (https://github.com/mr-zwets/AuthGuard): an identity's authhead locked
// in a covenant, with the authority to spend it tokenized as an "AuthKey" NFT.
//
// The covenant's script is determined by the key's category, so a guarded identity is recognised
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

// The compiled body of AuthGuard.cash: require the key at input 1, force output 0 back to the
// covenant. Recognised by its exact bytecode, so no CashScript tooling is needed to derive it.
const AUTHGUARD_BODY = "51ce8851d0009d6300cdc0c7886851";

// The covenant's redeem script for one key category. The category is byte-reversed because the
// script compares it against the transaction's own encoding of it, which is little-endian.
export function authGuardRedeemScript(category: string): Uint8Array {
  const reversedCategory = binToHex(hexToBin(category).reverse());
  return hexToBin(`20${reversedCategory}${AUTHGUARD_BODY}`);
}

// Both hash lengths a P2SH output can commit to, since deployments exist in both. A match at
// either is self-proving: spending the output means presenting this very redeem script, with
// this key's category already inside it.
export interface AuthGuardForms<T> {
  p2sh20: T;
  p2sh32: T;
}

export function authGuardLockingBytecodes(category: string): AuthGuardForms<string> {
  const redeemScript = authGuardRedeemScript(category);
  return {
    p2sh20: binToHex(encodeLockingBytecodeP2sh20(hash160(redeemScript))),
    p2sh32: binToHex(encodeLockingBytecodeP2sh32(hash256(redeemScript))),
  };
}

// Whether an identity output sits in the covenant this key category opens
export function isAuthGuardOf(keyCategory: string, lockingBytecode: string): boolean {
  const forms = authGuardLockingBytecodes(keyCategory);
  return lockingBytecode === forms.p2sh20 || lockingBytecode === forms.p2sh32;
}

// The key the covenant asks for at input 1: a token of its category carrying no amount, which
// with a category of 32 bytes on the covenant's side means an NFT without capability. The
// contract reads no commitment, so any is a key unless the caller knows which one was minted.
export function isAuthKey(utxo: Utxo, keyCategory: string, commitment?: string): boolean {
  const token = utxo.token;
  if (!token || token.category !== keyCategory) return false;
  if (token.amount !== 0n || token.nft?.capability !== "none") return false;
  return commitment === undefined || token.nft.commitment === commitment;
}
