import type { ElectrumClient, ElectrumUtxo } from "./extensions/types";

/**
 * Minimal provider interface — duck-typed to avoid deep imports from mainnet-js.
 */
interface ElectrumProvider {
  getUtxos(cashaddr: string): Promise<{
    txid: string;
    vout: number;
    satoshis: bigint;
    height?: number;
    token?: {
      category: string;
      amount: bigint;
      nft?: {
        capability: "none" | "mutable" | "minting";
        commitment: string;
      };
    };
  }[]>;
  getRawTransaction(txHash: string): Promise<string>;
}

/**
 * Create an ElectrumClient adapter from a mainnet-js ElectrumNetworkProvider.
 *
 * Bridges the mainnet-js Utxo format to the ElectrumUtxo format expected
 * by the extension system.
 */
export function createElectrumAdapter(provider: ElectrumProvider): ElectrumClient {
  return {
    async getUTXOs(address: string): Promise<ElectrumUtxo[]> {
      const utxos = await provider.getUtxos(address);
      return utxos.map((utxo) => {
        const result: ElectrumUtxo = {
          tx_hash: utxo.txid,
          tx_pos: utxo.vout,
          value: utxo.satoshis,
          script: "",
          ...(utxo.height !== undefined && { height: utxo.height }),
        };
        if (utxo.token) {
          result.token_data = {
            category: utxo.token.category,
            amount: utxo.token.amount?.toString(),
          };
          if (utxo.token.nft?.capability !== undefined || utxo.token.nft?.commitment !== undefined) {
            result.token_data.nft = {
              capability: utxo.token.nft?.capability ?? "none",
              commitment: utxo.token.nft?.commitment ?? "",
            };
          }
        }
        return result;
      });
    },

    async getRawTransaction(txid: string): Promise<string> {
      return provider.getRawTransaction(txid);
    },
  };
}
