import { hexToBin, type Output } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";

/**
 * Convert a mainnet-js Utxo to a libauth Output for use with parseNft().
 *
 * The parseNft() function requires a libauth Output with Uint8Array-based
 * token data. mainnet-js uses hex strings. This function bridges the two.
 *
 * lockingBytecode is set to an empty Uint8Array because the parsing VM
 * only accesses token data (via OP_UTXOTOKENCOMMITMENT), not the locking script.
 */
export function utxoToLibauthOutput(utxo: Utxo): Output {
  const output: Output = {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: utxo.satoshis,
  };

  if (utxo.token) {
    const hasNft = utxo.token.nft?.capability !== undefined || utxo.token.nft?.commitment !== undefined;
    output.token = {
      category: hexToBin(utxo.token.category),
      amount: utxo.token.amount ?? 0n,
    };
    if (hasNft) {
      output.token.nft = {
        capability: utxo.token.nft?.capability ?? "none",
        commitment: hexToBin(utxo.token.nft?.commitment ?? ""),
      };
    }
  }

  return output;
}
