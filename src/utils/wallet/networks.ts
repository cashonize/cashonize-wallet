import { NetworkType, networkConfig } from "@cashonize/bch-wallet-lib"

export type AppNetwork = 'mainnet' | 'chipnet';

export const appNetworks: AppNetwork[] = ['mainnet', 'chipnet'];

// The library's name for the network; chipnet is its built-in "testnet"
export function libraryNetwork(network: AppNetwork): NetworkType {
  return network === 'mainnet' ? NetworkType.Mainnet : NetworkType.Testnet;
}

// The IndexedDB database the library keeps the network's named wallets in
export function walletDbName(network: AppNetwork): string {
  return networkConfig(libraryNetwork(network)).dbName;
}

// The app's name for a wallet's network, which the library calls "testnet" for chipnet
export function appNetworkOf(walletNetwork: string): AppNetwork {
  return walletNetwork === 'mainnet' ? 'mainnet' : 'chipnet';
}
