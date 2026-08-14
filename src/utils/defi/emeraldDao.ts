// Emerald DAO keycard NFTs, each backed by a fixed amount of BCH.
//
// The DAO's vault contract minted in pairs: a keycard NFT to the depositor and a safebox NFT
// holding the BCH to the safebox contract. The safebox only releases its BCH in a transaction
// that spends it together with the matching keycard and burns both, so an unspent keycard always
// has its safebox behind it. The vault wrote the safebox amount into the keycard commitment when
// minting, which is why the backing can be read off the keycard itself without any lookup.
// Minting has ended, so no further keycards can be created.

import { hexToBin, binToNumberUint16LE, binToBigIntUint64LE } from "@bitauth/libauth";

// the only Emerald DAO series that was minted, on mainnet
export const EMERALD_DAO_CATEGORY = "180f0db4465c2af5ef9363f46bacde732fa6ffb3bfe65844452078085b2e7c93";

// A keycard commitment is the serial number of the keycard (2 bytes) followed by the satoshis
// in its safebox (8 bytes), both little-endian
const COMMITMENT_BYTES = 10;
const SERIAL_BYTES = 2;

export function parseEmeraldKeycard(commitment: string | undefined) {
  if (!commitment || commitment.length !== COMMITMENT_BYTES * 2) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(commitment)) return undefined;
  const commitmentBytes = hexToBin(commitment);
  return {
    serial: binToNumberUint16LE(commitmentBytes.slice(0, SERIAL_BYTES)),
    satoshis: binToBigIntUint64LE(commitmentBytes.slice(SERIAL_BYTES))
  };
}
