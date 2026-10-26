import { hexToBin } from '@bitauth/libauth'
import { parseNft, type NftParseInfo, type ParseResult } from 'src/parsing/nftParsing'
import { BADGERCOIN_CATEGORY } from 'src/utils/defi/badgersStake'

// The HoneyBadgers registry lists its NFT types without the bytecode that tells an NFT's type. A
// commitment opens with a 2-byte little-endian id, and the registry keys its types by that id as a
// script number: "" is Honey (id 0), "14" Badger #20. Honey then carries the BadgerCoins earned, a
// Badger its stats, read the way badgers.cash shows them.
// Contract: https://github.com/SayoshiNakamario/BadgersStake
//
// <0> OP_UTXOTOKENCOMMITMENT
// OP_SIZE <40> OP_EQUAL OP_IF
//   <0x01> OP_TOALTSTACK                               // Type "01": a Badger
//   <2> OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK      // its id, as the registry keys its type
//   <1> OP_SPLIT OP_SWAP <0x00> OP_CAT OP_TOALTSTACK   // 7 times: a stat, one byte read unsigned
//   OP_DROP                                            // the zero padding
// OP_ELSE
//   OP_0 OP_TOALTSTACK                                 // Type "": Honey
//   <2> OP_SPLIT OP_NIP OP_TOALTSTACK                  // BadgerCoins earned, after the id
// OP_ENDIF
const honeyBadgersParseInfo: NftParseInfo = {
  bytecode: "00cf8201288763516b527f7c816b517f7c01007e6b517f7c01007e6b517f7c01007e6b517f7c01007e6b517f7c01007e6b517f7c01007e6b517f7c01007e6b7567006b527f776b68",
  types: {
    "": { name: "Honey", fields: ["earned"] },
    "01": { name: "Badger", fields: ["id", "level", "strength", "stamina", "agility", "wisdom", "attack", "defence"] },
  },
  fields: {
    earned: { name: "Earned", encoding: { type: "number", unit: "BADGER" } },
    id: { name: "Id", encoding: { type: "number" } },
    level: { name: "Level", encoding: { type: "number" } },
    strength: { name: "Strength", encoding: { type: "number" } },
    stamina: { name: "Stamina", encoding: { type: "number" } },
    agility: { name: "Agility", encoding: { type: "number" } },
    wisdom: { name: "Wisdom", encoding: { type: "number" } },
    attack: { name: "Attack", encoding: { type: "number" } },
    defence: { name: "Defence", encoding: { type: "number" } },
  },
};

function parseCommitment(commitment: string) {
  return parseNft({
    lockingBytecode: new Uint8Array(),
    valueSatoshis: 0n,
    token: { category: hexToBin(BADGERCOIN_CATEGORY), amount: 0n, nft: { capability: 'none', commitment: hexToBin(commitment) } },
  }, honeyBadgersParseInfo);
}

// The registry type a HoneyBadgers NFT's metadata is listed under, undefined for any other NFT
export function honeyBadgersTypeKey(category: string, commitment: string) {
  if (category !== BADGERCOIN_CATEGORY) return undefined;
  const result = parseCommitment(commitment);
  if (!result.success) return undefined;
  return result.nftType === "" ? "" : result.fields?.[0];
}

// The fields only: the name and icon of every HoneyBadgers NFT come from the registry
export function parseHoneyBadgersNft(commitment: string): ParseResult {
  const result = parseCommitment(commitment);
  if (!result.success) return result;
  return { success: true, namedFields: result.namedFields ?? [] };
}
