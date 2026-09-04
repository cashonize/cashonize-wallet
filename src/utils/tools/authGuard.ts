// The AuthGuard standard (https://github.com/mr-zwets/AuthGuard): an identity's authhead locked
// in a covenant, with the authority to spend it tokenized as an "AuthKey" NFT.
//
// The covenant's script is determined by the key's category, so a guarded identity is recognised
// the way the standard verifies one: derive the locking bytecode and compare. Every mention of
// the script lives here; the resolve in authchainIdentity.ts reads it.

import type { Utxo } from "mainnet-js";
import {
  binToHex,
  encodeCashAddress,
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

type NetworkPrefix = "bitcoincash" | "bchtest" | "bchreg";

// The covenant's addresses in the token-aware form, since a guarded identity output carries a token
export function authGuardAddresses(category: string, networkPrefix: NetworkPrefix): AuthGuardForms<string> {
  const redeemScript = authGuardRedeemScript(category);
  // the payload's length is what makes an address p2sh20 or p2sh32, the type only says p2sh
  const encode = (payload: Uint8Array) =>
    encodeCashAddress({ prefix: networkPrefix, type: "p2shWithTokens", payload, throwErrors: true }).address;
  return { p2sh20: encode(hash160(redeemScript)), p2sh32: encode(hash256(redeemScript)) };
}

// The key the covenant asks for at input 1: a token of its category carrying no amount, which
// with a category of 32 bytes on the covenant's side means an NFT without capability. The
// commitment is the key's own business, so any commitment is one.
export function isAuthKey(utxo: Utxo, keyCategory: string): boolean {
  const token = utxo.token;
  if (!token || token.category !== keyCategory) return false;
  return token.amount === 0n && token.nft?.capability === "none";
}
