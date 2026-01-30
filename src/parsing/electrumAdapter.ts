import type { ElectrumClient, ElectrumUtxo } from "./extensions/types";

/**
 * Minimal provider interface — duck-typed to avoid deep imports from mainnet-js.
 */
interface ElectrumProvider {
  getUtxos(cashaddr: string): Promise<{
    txid: string;
    vout: number;
    satoshis: number;
    height?: number;
    token?: {
      tokenId: string;
      amount: bigint;
      capability?: "none" | "mutable" | "minting";
      commitment?: string;
    };
  }[]>;
  getRawTransaction(txHash: string): Promise<string>;
}

/**
 * Create an ElectrumClient adapter from a mainnet-js ElectrumNetworkProvider.
 *
 * Bridges the mainnet-js UtxoI format to the ElectrumUtxo format expected
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
          value: BigInt(utxo.satoshis),
          script: "",
          ...(utxo.height !== undefined && { height: utxo.height }),
        };
        if (utxo.token) {
          result.token_data = {
            category: utxo.token.tokenId,
            amount: utxo.token.amount?.toString(),
          };
          if (utxo.token.capability !== undefined || utxo.token.commitment !== undefined) {
            result.token_data.nft = {
              capability: utxo.token.capability ?? "none",
              commitment: utxo.token.commitment ?? "",
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
