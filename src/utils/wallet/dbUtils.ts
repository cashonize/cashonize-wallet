import { pruneWalletCaches } from "@cashonize/bch-wallet-lib"
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb"
import type { WalletDbEntryI } from "@cashonize/bch-wallet-lib"
import { appNetworks, walletDbName, type AppNetwork } from "src/utils/wallet/networks"

export interface WalletInfo {
  name: string;
  // the networks the name has a stored wallet on, in appNetworks order: one, except for an older
  // wallet that also has its chipnet copy (docs/indexeddb.md)
  networks: AppNetwork[];
}

// IndexedDBProvider is the library's own class, so the database name, its version and the shape
// of a record stay its business. Only the layer above it is bypassed, for the reasons below.
// Checking a wallet exists, reading its id and deleting it go through the library's
// namedWalletExists, getNamedWalletId and deleteNamedWallet instead.

// Every network's stored wallets, read once per database. The library has no wallet listing above
// the storage provider, so this uses its getWallets().
async function storedWalletsPerNetwork(): Promise<{ network: AppNetwork; wallets: WalletDbEntryI[] }[]> {
  const databases = appNetworks.map(network => ({ network, db: new IndexedDBProvider(walletDbName(network)) }));
  await Promise.all(databases.map(({ db }) => db.init()));
  try {
    return await Promise.all(databases.map(async ({ network, db }) => ({ network, wallets: await db.getWallets() })));
  } finally {
    await Promise.all(databases.map(({ db }) => db.close()));
  }
}

export async function getAllWalletsWithNetworkInfo(): Promise<WalletInfo[]> {
  const walletInfos = new Map<string, WalletInfo>();
  for (const { network, wallets } of await storedWalletsPerNetwork()) {
    for (const walletEntry of wallets) {
      const walletInfo = walletInfos.get(walletEntry.name) ?? { name: walletEntry.name, networks: [] };
      walletInfo.networks.push(network);
      walletInfos.set(walletEntry.name, walletInfo);
    }
  }
  return [...walletInfos.values()];
}

// Every wallet's stored id, from every network's database. The prune needs these to work out which
// cached keys still belong to a wallet: an id missing here has its cached keys deleted.
async function getAllStoredWalletIds(): Promise<string[]> {
  const storedIds: string[] = [];
  for (const { wallets } of await storedWalletsPerNetwork()) {
    for (const walletEntry of wallets) {
      if (walletEntry.wallet) storedIds.push(walletEntry.wallet);
    }
  }
  return storedIds;
}

// Deletes the cached keys of every wallet that is no longer in the databases. An HD wallet keeps
// a private key per address in the library's wallet cache, and deleting a wallet left these
// keys behind up to and including v0.12, so working from the wallets that remain rather than
// from the one just deleted is what clears those too.
export async function pruneDeletedWalletCaches(): Promise<void> {
  const storedWalletIds = await getAllStoredWalletIds();
  await pruneWalletCaches(storedWalletIds);
}
