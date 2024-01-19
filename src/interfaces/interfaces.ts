import { type UtxoI } from "mainnet-js"

export interface TokenData {
  tokenId: string,
  amount?: bigint,
  nfts?: UtxoI[]
}