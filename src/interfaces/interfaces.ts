import { type UtxoI } from "mainnet-js"

export type TokenList = (TokenDataNFT | TokenDataFT)[]

export interface TokenDataNFT {
  tokenId: string,
  nfts: UtxoI[],
  authUtxo?: UtxoI
}

export interface TokenDataFT {
  tokenId: string,
  amount: bigint,
  authUtxo?: UtxoI
}