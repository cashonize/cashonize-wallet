// Local implementation of message signing with fixed varint encoding
// Workaround for mainnet-js 2.7.27 bug, fixed in 2.7.33
// (Functions made to be sync, matching mainnet-js 3.0 direction)
// File can be removed when upgrading to mainnet-js >= 2.7.33

import {
  bigIntToCompactUint,
  binToBase64,
  secp256k1,
  sha256,
  utf8ToBin,
} from "@bitauth/libauth";

/**
 * message_magic - Add "Magic", per standard bitcoin message signing.
 *
 * The magic is adding "\x18" (24 in decimal), "Bitcoin Signed Message\n",
 * followed by the message length as a Bitcoin varint, then the message.
 */
function message_magic(str: string): Uint8Array {
  const msgBytes = utf8ToBin(str);
  const payload = `\x18Bitcoin Signed Message:\n`;
  return new Uint8Array([
    ...utf8ToBin(payload),
    ...bigIntToCompactUint(BigInt(msgBytes.length)),
    ...msgBytes,
  ]);
}

function hash_message(str: string): Uint8Array {
  const h = sha256.hash;
  return h(h(message_magic(str)));
}

export interface SignedMessageResponse {
  raw: {
    ecdsa: string;
    schnorr: string;
    der: string;
  };
  details: {
    recoveryId: number;
    compressed: boolean;
    messageHash: string;
  };
  signature: string;
}

/**
 * Sign a message with a private key using Bitcoin's message signing standard.
 */
export function signMessage(
  message: string,
  privateKey: Uint8Array
): SignedMessageResponse {
  const messageHash = hash_message(message);
  const rs = secp256k1.signMessageHashRecoverableCompact(privateKey, messageHash);
  if (typeof rs === "string") {
    throw new Error(rs);
  }
  const sigDer = secp256k1.signMessageHashDER(privateKey, messageHash) as Uint8Array;
  const sigSchnorr = secp256k1.signMessageHashSchnorr(privateKey, messageHash) as Uint8Array;
  const electronEncoding = new Uint8Array([
    ...[31 + rs.recoveryId],
    ...rs.signature,
  ]);
  return {
    raw: {
      ecdsa: binToBase64(rs.signature),
      schnorr: binToBase64(sigSchnorr),
      der: binToBase64(sigDer),
    },
    details: {
      recoveryId: rs.recoveryId,
      compressed: true,
      messageHash: binToBase64(messageHash),
    },
    signature: binToBase64(electronEncoding),
  };
}
