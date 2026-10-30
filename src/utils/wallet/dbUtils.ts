import { pruneWalletCaches } from "@cashonize/bch-wallet-lib"
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb"
import { walletDbName } from "src/utils/wallet/networks"

export interface WalletInfo {
  name: string;
  hasMainnet: boolean;
  hasChipnet: boolean;
}

// IndexedDBProvider is the library's own class, so the database name, its version and the shape
// of a record stay its business. Only the layer above it is bypassed, for the reasons below.
// Checking a wallet exists, reading its id and deleting it go through the library's
// namedWalletExists, getNamedWalletId and deleteNamedWallet instead.

// The library has no wallet listing above the storage provider, so this uses its getWallets().
export async function getAllWalletsWithNetworkInfo(): Promise<WalletInfo[]> {
  // Get wallets from both networks
  const mainnetDb = new IndexedDBProvider(walletDbName('mainnet'));
  const chipnetDb = new IndexedDBProvider(walletDbName('chipnet'));

  await Promise.all([mainnetDb.init(), chipnetDb.init()]);

  try {
    const [mainnetWallets, chipnetWallets] = await Promise.all([
      mainnetDb.getWallets(),
      chipnetDb.getWallets()
    ]);

    const mainnetNames = new Set(mainnetWallets.map(w => w.name));
    const chipnetNames = new Set(chipnetWallets.map(w => w.name));

    // Combine all unique wallet names
    const allNames = new Set([...mainnetNames, ...chipnetNames]);

    const walletInfos: WalletInfo[] = [];
    for (const name of allNames) {
      walletInfos.push({
        name,
        hasMainnet: mainnetNames.has(name),
        hasChipnet: chipnetNames.has(name)
      });
    }

    return walletInfos;
  } finally {
    await Promise.all([mainnetDb.close(), chipnetDb.close()]);
  }
}

// Every wallet's stored id, from both databases. The prune needs these to work out which cached
// keys still belong to a wallet. Each database is read once, since getWallets already returns the
// stored id next to the name.
async function getAllStoredWalletIds(): Promise<string[]> {
  const mainnetDb = new IndexedDBProvider(walletDbName('mainnet'));
  const chipnetDb = new IndexedDBProvider(walletDbName('chipnet'));
  await Promise.all([mainnetDb.init(), chipnetDb.init()]);

  try {
    const [mainnetWallets, chipnetWallets] = await Promise.all([
      mainnetDb.getWallets(),
      chipnetDb.getWallets()
    ]);
    const storedIds: string[] = [];
    for (const walletEntry of [...mainnetWallets, ...chipnetWallets]) {
      if (walletEntry.wallet) storedIds.push(walletEntry.wallet);
    }
    return storedIds;
  } finally {
    await Promise.all([mainnetDb.close(), chipnetDb.close()]);
  }
}

// Deletes the cached keys of every wallet that is no longer in the databases. An HD wallet keeps
// a private key per address in the library's wallet cache, and deleting a wallet left these
// keys behind up to and including v0.12, so working from the wallets that remain rather than
// from the one just deleted is what clears those too.
export async function pruneDeletedWalletCaches(): Promise<void> {
  const storedWalletIds = await getAllStoredWalletIds();
  await pruneWalletCaches(storedWalletIds);
}
