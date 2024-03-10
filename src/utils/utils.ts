import { type UtxoI } from "mainnet-js"

export function getAllNftTokenBalances(tokenUtxos: UtxoI[]){
  const result:Record<string, number> = {};
  const nftUtxos = tokenUtxos.filter((val) => val.token?.commitment !== undefined);
  for (const utxo of nftUtxos) {
    if(!utxo.token?.tokenId) return // should never happen
    if (!result[utxo.token.tokenId]) {
      result[utxo.token.tokenId] = 0;
    }
    result[utxo.token.tokenId] += 1;
  }
  return result
}

export function getFungibleTokenBalances(tokenUtxos: UtxoI[]){
  const result:Record<string, bigint> = {};
  const fungiblesUtxos = tokenUtxos.filter((val) => val.token?.amount);
  for (const utxo of fungiblesUtxos) {
    if(!utxo.token?.tokenId) return  // should never happen
    if (!result[utxo.token.tokenId]) {
      result[utxo.token?.tokenId] = 0n;
    }
    result[utxo.token?.tokenId] += utxo.token.amount;
  }
  return result
}