import type { Utxo, ElectrumRawTransaction, Wallet, TestNetWallet, HDWallet, TestNetHDWallet } from "mainnet-js"

export type WalletType = Wallet | TestNetWallet | HDWallet | TestNetHDWallet;

export const CurrencySymbols = {
  usd: "$",
  eur: "€",
  gbp: "£",
  cad: "C$",
  aud: "A$"
} as const

export const CurrencyShortNames = {
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  cad: "CAD",
  aud: "AUD"
} as const

export type Currency = keyof typeof CurrencySymbols;

export type DateFormat = "DD/MM/YY" | "MM/DD/YY" | "YY-MM-DD";

export type ExchangeRateProvider = "default" | "bitpay" | "coingecko" | "coinbase";

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
  category: string,
  nfts: Utxo[],
  authUtxo?: Utxo
}

export interface TokenDataFT {
  category: string,
  amount: bigint,
  authUtxo?: Utxo
}

export type WalletHistoryReturnType = Awaited<ReturnType<Wallet['getHistory']>>;

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