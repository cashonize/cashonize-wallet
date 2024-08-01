import { NFTCapability, type UtxoI } from "mainnet-js"

export const CurrencySymbols = {
  usd: "$",
  eur: "€"
}

export const CurrencyShortNames = {
  usd: "USD",
  eur: "EUR"
}


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

export type TokenData = TokenDataNFT | TokenDataFT

export type TokenList = TokenData[]


export interface DappMetadata {
  description: string,
  icons: string[]
  name: string,
  url: string
}

export interface dialogInfo {
  message: string
  txid: string
}

export interface bcmrTokenMetadata {
  name: string
  description: string
  token: {
    category: string
    decimals: number
    symbol: string
  }
  is_nft: boolean
  nfts?: Record<string, bcmrNftMetadata>
  uris: Record<string, string>
  extensions: Record<string, any>
}

export interface bcmrNftMetadata {
  name: string
  description: string
  uris: Record<string, string>
  extensions: Record<string, any>
}

export interface bcmrIndexerResponse {
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
  extensions: Record<string, any>
}

export interface AbiInput {
  name: string;
  type: string;
}
export interface AbiFunction {
  name: string;
  covenant?: boolean;
  inputs: AbiInput[];
}
export interface Artifact {
  contractName: string;
  constructorInputs: AbiInput[];
  abi: AbiFunction[];
  bytecode: string;
  source: string;
  compiler: {
      name: string;
      version: string;
  };
  updatedAt: string;
}
export interface ContractInfo {
  contract?: {
    abiFunction: AbiFunction;
    redeemScript: Uint8Array;
    artifact: Partial<Artifact>;
  }
}

export interface ElectrumTokenData {
  amount: string;
  category: string;
  nft?: {
    capability?: NFTCapability;
    commitment?: string;
  };
}
