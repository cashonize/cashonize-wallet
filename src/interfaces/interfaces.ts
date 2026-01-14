import type { UtxoI, ElectrumRawTransaction, TokenSendRequest, TokenMintRequest, NFTCapability, TokenGenesisRequest, Wallet } from "mainnet-js"

export const CurrencySymbols = {
  usd: "$",
  eur: "€"
} as const

export const CurrencyShortNames = {
  usd: "USD",
  eur: "EUR"
} as const

export type DateFormat = "DD/MM/YY" | "MM/DD/YY" | "YY-MM-DD";

export type QRCodeAnimationName =
  | 'FadeInTopDown'
  | 'FadeInCenterOut'
  | 'MaterializeIn'
  | 'RadialRipple'
  | 'RadialRippleIn';
export interface QrCodeElement extends HTMLElement {
  animateQRCode: (animationName: QRCodeAnimationName) => void;
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

export type TokenSendRequestParams = ConstructorParameters<typeof TokenSendRequest>[0];

export type TokenMintRequestParams = ConstructorParameters<typeof TokenMintRequest>[0];

export type TokeneGenesisRequestParams = ConstructorParameters<typeof TokenGenesisRequest>[0];

export type WalletHistoryReturnType = Awaited<ReturnType<Wallet['getHistory']>>;

// manual type because 'number' type on 'amount' causes issues in strict mode
export type TokenBurnRequestParams = {
  tokenId: string;
  capability?: NFTCapability;
  commitment?: string;
  amount?: bigint;
  cashaddr?: string;
};

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
    decimals?: number | undefined
    symbol: string
  }
  is_nft?: boolean | undefined
  nfts?: Record<string, BcmrNftMetadata> | undefined
  uris?: Record<string, string> | undefined
  extensions?: BcmrExtensions | undefined
}

export interface BcmrNftMetadata {
  name: string
  description: string
  uris?: Record<string, string> | undefined
  extensions?: BcmrExtensions | undefined
}

export type BcmrExtensions = {
  [extensionIdentifier: string]:
    | string
    | { [key: string]: string }
    | { [keyA: string]: { [keyB: string]: string } };
}

export type ElectrumRawTransactionVout = ElectrumRawTransaction["vout"][number]
export type ElectrumTokenData = ElectrumRawTransactionVout["tokenData"]