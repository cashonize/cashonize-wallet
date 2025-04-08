import { type UtxoI, type NFTCapability } from "mainnet-js"

export const CurrencySymbols = {
  usd: "$",
  eur: "€"
}

export const CurrencyShortNames = {
  usd: "USD",
  eur: "EUR"
}

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

export interface DappMetadata {
  description: string,
  icons: string[]
  name: string,
  url: string
}

export interface DialogInfo {
  message: string
  txid: string
}

export interface BcmrTokenMetadata {
  name: string
  description: string
  token: {
    category: string
    decimals: number
    symbol: string
  }
  is_nft: boolean
  nfts?: Record<string, BcmrNftMetadata>
  uris: Record<string, string>
  extensions: BcmrExtensions
}

export interface BcmrNftMetadata {
  name: string
  description: string
  uris: Record<string, string>
  extensions: BcmrExtensions
}

export interface BcmrIndexerResponse {
  name: string
  description: string
  token: {
    category: string
    decimals: number
    symbol: string
  }
  is_nft: boolean
  type_metadata: any
  uris: Record<string, string>
  extensions: BcmrExtensions
}

export type BcmrExtensions = {
  [extensionIdentifier: string]:
    | string
    | { [key: string]: string }
    | { [keyA: string]: { [keyB: string]: string } };
}
export interface ElectrumTokenData {
  amount: string;
  category: string;
  nft?: {
    capability?: NFTCapability;
    commitment?: string;
  };
}
