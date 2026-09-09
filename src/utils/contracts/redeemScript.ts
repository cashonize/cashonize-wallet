// A contract the wallet watches is named by its redeem script, never by its address: the address
// is derived by hashing the script, so the two cannot disagree and every parameter shown beside a
// balance is decoded rather than asserted. What a script means is contractManifest.ts's job.

import {
  encodeLockingBytecodeP2sh20,
  encodeLockingBytecodeP2sh32,
  hash160,
  hash256,
  hexToBin,
  lockingBytecodeToCashAddress,
} from "@bitauth/libauth";

// How a redeem script is hashed into its address. Both are valid for any script; which one a
// contract uses is a fact about how it was funded, so the manifest says which.
export type AddressType = 'p2sh20' | 'p2sh32';

// The address a script is funded at. Undefined when the script is not whole bytes of hex, which
// is the one thing an adder can get wrong that has no honest answer.
export function contractAddress(
  redeemScript: string,
  addressType: AddressType,
  prefix: string,
  tokenSupport = false,
): string | undefined {
  if (!/^([0-9a-fA-F]{2})+$/.test(redeemScript)) return undefined;
  const scriptBytes = hexToBin(redeemScript);
  const bytecode = addressType === 'p2sh20'
    ? encodeLockingBytecodeP2sh20(hash160(scriptBytes))
    : encodeLockingBytecodeP2sh32(hash256(scriptBytes));
  const result = lockingBytecodeToCashAddress({
    bytecode,
    prefix: prefix as "bitcoincash" | "bchtest" | "bchreg",
    tokenSupport,
  });
  return typeof result === "string" ? undefined : result.address;
}
