import type { Output } from "@bitauth/libauth";
import type { IdentitySnapshot } from "../bcmr-v2.schema";

/**
 * Minimal Electrum client interface for extensions
 */
export interface ElectrumClient {
  /**
   * Get UTXOs for an address
   */
  getUTXOs(address: string): Promise<ElectrumUtxo[]>;

  /**
   * Get raw transaction hex
   */
  getRawTransaction(txid: string): Promise<string>;
}

/**
 * Electrum UTXO format (from Electrum protocol)
 */
export interface ElectrumUtxo {
  tx_hash: string;
  tx_pos: number;
  value: bigint;
  script: string;
  height?: number;
  token_data?: {
    category: string;
    amount?: string;
    nft?: {
      capability: "none" | "mutable" | "minting";
      commitment: string;
    };
  };
}

/**
 * Extension handler function type
 * Receives a UTXO and returns a modified UTXO (can modify commitment, value, etc.)
 */
export type ExtensionHandler = (
  utxo: Output,
  identitySnapshot: IdentitySnapshot,
  electrumClient: ElectrumClient,
  networkPrefix: string,
) => Promise<Output>;

/**
 * Extension registry maps extension names to method handlers
 */
export interface ExtensionRegistry {
  [extensionName: string]: {
    [methodName: string]: ExtensionHandler;
  };
}
