import { knownNetworks, networkConfig, registerNetwork } from "@cashonize/bch-wallet-lib"

export type AppNetwork = 'mainnet' | 'chipnet' | 'testnet4';

export const appNetworks: AppNetwork[] = ['mainnet', 'chipnet', 'testnet4'];

// The test networks a development wallet can be made on, in the order they are offered
export const devNetworks: AppNetwork[] = ['chipnet', 'testnet4'];

// The library's name for each network: chipnet is its built-in "testnet", testnet4 one registered
// below. Stored wallet ids and the library's caches carry these names.
const libraryNetworks: Record<AppNetwork, string> = {
  mainnet: 'mainnet',
  chipnet: 'testnet',
  testnet4: 'testnet4',
};

// Testnet4 is not built into the library. It shares chipnet's address prefix and key version, and
// its genesis: the checkpoint after chipnet split off is what tells a testnet4 server from a
// chipnet one. Registered as this module loads, which is before any wallet of it is loaded and
// before pruneWalletCaches, which would drop the caches of a network it does not know. The
// servers here are only the library's fallback; the store sets the selected ones.
if (!knownNetworks().some(config => config.name === 'testnet4')) {
  registerNetwork({
    name: 'testnet4',
    addressPrefix: 'bchtest',
    keyVersion: 'testnet',
    dbName: 'bchtest4',
    servers: ['wss://testnet4.imaginary.cash:50004'],
    chain: {
      genesisHash: '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
      checkpoint: {
        height: 227000,
        hash: '0000000028741efb2fdaf5be975e4c313a90e3d44f7b855c224cea95583ca26b',
      },
    },
  });
}

export function libraryNetwork(network: AppNetwork): string {
  return libraryNetworks[network];
}

// The IndexedDB database the library keeps the network's named wallets in
export function walletDbName(network: AppNetwork): string {
  return networkConfig(libraryNetwork(network)).dbName;
}

// The app's name for a wallet's network, from the library's name for it
export function appNetworkOf(walletNetwork: string): AppNetwork {
  const network = appNetworks.find(candidate => libraryNetworks[candidate] === walletNetwork);
  if (!network) throw new Error(`Not a network of this app: ${walletNetwork}`);
  return network;
}

// The network last opened, kept in localStorage; mainnet when unset or not one of this app's
export function storedAppNetwork(): AppNetwork {
  const stored = localStorage.getItem('network');
  return appNetworks.find(network => network === stored) ?? 'mainnet';
}
