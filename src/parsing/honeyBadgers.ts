import type { Utxo } from '@cashonize/bch-wallet-lib'
import { parseNft, type NftParseInfo } from 'src/parsing/nftParsing'
import { utxoToLibauthOutput } from 'src/parsing/utxoConverter'

// HoneyBadgers NFTs come without parse info in their registry, so this stands in for it. A
// commitment opens with the NFT's id, 2 bytes little-endian. A Badger's is the full 40 bytes, its
// traits after the id; Honey (id 0) is minted by the staking contract with the BadgerCoins its
// stake earned after the id, as a script number. Contract: https://github.com/SayoshiNakamario/BadgersStake
//
// <0> OP_UTXOTOKENCOMMITMENT
// OP_SIZE <40> OP_EQUAL OP_IF
//   <0x01> OP_TOALTSTACK                          // Type "01": a Badger
//   <2> OP_SPLIT OP_DROP OP_BIN2NUM OP_TOALTSTACK // its id, the traits left out
// OP_ELSE
//   OP_0 OP_TOALTSTACK                            // Type "": Honey
//   <2> OP_SPLIT OP_NIP OP_TOALTSTACK             // BadgerCoins earned, after the id
// OP_ENDIF
const honeyBadgersParseInfo: NftParseInfo = {
  bytecode: "00cf8201288763516b527f75816b67006b527f776b68",
  types: {
    "": { name: "Honey", description: "BitcoinCash HoneyBadger Honey", fields: ["earned"] },
    "01": { name: "HoneyBadger", description: "BitcoinCash HoneyBadger", fields: ["badgerId"] },
  },
  fields: {
    earned: { name: "Earned", encoding: { type: "number", unit: "BADGER" } },
    badgerId: { name: "Badger", encoding: { type: "number" } },
  },
};

export function parseHoneyBadgersNft(utxo: Utxo) {
  return parseNft(utxoToLibauthOutput(utxo), honeyBadgersParseInfo);
}
