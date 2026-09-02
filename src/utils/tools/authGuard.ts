// The AuthGuard standard (https://github.com/mr-zwets/AuthGuard), which CashTokens Studio uses:
// an identity's authhead is locked in a covenant and the authority to spend it is tokenized as an
// "AuthKey" NFT held in an ordinary wallet. The covenant address is fully determined by the key's
// category, so this wallet can find what a key guards without being told: derive the address and
// list it.
//
// Every mention of the covenant's script lives here, the way the publication format lives in
// authchainIdentity.ts. Neither module imports the other; the store composes them.

import type { Utxo } from "mainnet-js";
import {
  binToHex,
  encodeCashAddress,
  hash160,
  hash256,
  hexToBin,
} from "@bitauth/libauth";

// The compiled body of AuthGuard.cash: require the key at input 1, force output 0 back to the
// covenant. Recognised by its exact bytecode, so no CashScript tooling is needed to derive it.
const AUTHGUARD_BODY = "51ce8851d0009d6300cdc0c7886851";

// An AuthKey carries no metadata and no value: it is the NFT itself that is the authority
export function isAuthKeyCandidate(utxo: Utxo): boolean {
  const nft = utxo.token?.nft;
  if (!nft) return false;
  return nft.commitment === "00" && nft.capability === "none" && utxo.token?.amount === 0n;
}

// The covenant's redeem script for one key category. The category is byte-reversed because the
// script compares it against the transaction's own encoding of it, which is little-endian.
export function authGuardRedeemScript(category: string): Uint8Array {
  const reversedCategory = binToHex(hexToBin(category).reverse());
  return hexToBin(`20${reversedCategory}${AUTHGUARD_BODY}`);
}

type NetworkPrefix = "bitcoincash" | "bchtest" | "bchreg";

// Both hash lengths a P2SH address can commit to. Deployments exist in both, and a hit at either
// is self-proving: spending a coin found there means presenting this very redeem script, with this
// key's category already inside it. So both are derived and both are listed, in the token-aware
// form, since a guarded identity output carries a token.
export interface AuthGuardAddresses {
  p2sh20: string;
  p2sh32: string;
}

export function authGuardAddresses(category: string, networkPrefix: NetworkPrefix): AuthGuardAddresses {
  const redeemScript = authGuardRedeemScript(category);
  // the payload's length is what makes an address p2sh20 or p2sh32, the type only says p2sh
  const encode = (payload: Uint8Array) =>
    encodeCashAddress({ prefix: networkPrefix, type: "p2shWithTokens", payload, throwErrors: true }).address;
  return { p2sh20: encode(hash160(redeemScript)), p2sh32: encode(hash256(redeemScript)) };
}

// What a key guards: the coins sitting at its covenant addresses. A coin carrying a token names
// the identity it belongs to directly; confirming that it really is that category's authhead is
// the caller's job, through the authchain lookup.
export interface GuardedOutput {
  utxo: Utxo;
  category: string;
}

export interface GuardContents {
  identified: GuardedOutput[];
  // Guarded identity outputs carrying no token. Naming one needs a lookup from its txid back to
  // the authchain it ends, which this wallet cannot do yet, so they are counted rather than
  // dropped: a key that guards only these guards something, and saying it guards nothing lies.
  unidentified: number;
}

export function guardContentsFromUtxos(utxos: Utxo[]): GuardContents {
  // Only the identity output is at vout 0; anything else at the address is somebody paying the
  // covenant, which guards nothing
  const identityOutputs = utxos.filter(utxo => utxo.vout === 0);
  const identified = identityOutputs.flatMap(utxo =>
    utxo.token?.category ? [{ utxo, category: utxo.token.category }] : []
  );
  return { identified, unidentified: identityOutputs.length - identified.length };
}
