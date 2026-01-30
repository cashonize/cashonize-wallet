import { hexToBin, type Output } from "@bitauth/libauth";
import type { UtxoI } from "mainnet-js";

/**
 * Convert a mainnet-js UtxoI to a libauth Output for use with parseNft().
 *
 * The parseNft() function requires a libauth Output with Uint8Array-based
 * token data. mainnet-js uses hex strings. This function bridges the two.
 *
 * lockingBytecode is set to an empty Uint8Array because the parsing VM
 * only accesses token data (via OP_UTXOTOKENCOMMITMENT), not the locking script.
 */
export function utxoIToLibauthOutput(utxo: UtxoI): Output {
  const output: Output = {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: BigInt(utxo.satoshis),
  };

  if (utxo.token) {
    const hasNft = utxo.token.capability !== undefined || utxo.token.commitment !== undefined;
    output.token = {
      category: hexToBin(utxo.token.tokenId),
      amount: utxo.token.amount ?? 0n,
    };
    if (hasNft) {
      output.token.nft = {
        capability: utxo.token.capability ?? "none",
        commitment: hexToBin(utxo.token.commitment ?? ""),
      };
    }
  }

  return output;
}
