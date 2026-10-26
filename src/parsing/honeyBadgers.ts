import { hexToBin } from '@bitauth/libauth'
import { parseNft, type NftParseInfo, type ParseResult } from 'src/parsing/nftParsing'
import { BADGERCOIN_CATEGORY } from 'src/utils/defi/badgersStake'

// The HoneyBadgers registry lists its NFT types but carries no bytecode to tell which one an NFT
// is, so the indexer has it as a sequential collection and looks its NFTs up by their whole
// commitment, which matches none. A commitment opens with the NFT's id, 2 bytes little-endian, and
// the registry keys its types by that id as a script number: "" is Honey (id 0), "14" Badger #20.
// After the id a Badger carries its traits, 38 bytes the registry lists already; Honey carries the
// BadgerCoins its stake earned, as the staking contract mints it.
// Contract: https://github.com/SayoshiNakamario/BadgersStake
//
// <0> OP_UTXOTOKENCOMMITMENT
// <2> OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK // Type: the id, as the registry keys it
// OP_SIZE <38> OP_EQUAL OP_IF
//   OP_DROP                                     // A Badger's traits
// OP_ELSE
//   OP_TOALTSTACK                               // Honey's BadgerCoins earned
// OP_ENDIF
const honeyBadgersParseInfo: NftParseInfo = {
  bytecode: "00cf527f7c816b820126876375676b68",
  types: {
    "": { name: "Honey", fields: ["earned"] },
  },
  fields: {
    earned: { name: "Earned", encoding: { type: "number", unit: "BADGER" } },
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
  return result.success ? result.nftType : undefined;
}

// Honey's BadgerCoins earned; the name and icon of every HoneyBadgers NFT come from the registry
export function parseHoneyBadgersNft(commitment: string): ParseResult {
  const result = parseCommitment(commitment);
  if (!result.success) return result;
  return { success: true, namedFields: result.namedFields ?? [] };
}
