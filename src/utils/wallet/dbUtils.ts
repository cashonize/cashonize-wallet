import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"

export interface WalletInfo {
  name: string;
  hasMainnet: boolean;
  hasChipnet: boolean;
}

export async function namedWalletExistsInDb(
  name: string,
  dbName: "bitcoincash" | "bchtest"
): Promise<boolean> {
  if (!name) throw new Error("Named wallets must have a non-empty name");

  const db = new IndexedDBProvider(dbName);
  await db.init();
  try {
    return await db.walletExists(name);
  } finally {
    await db.close();
  }
}

export async function getAllWalletsWithNetworkInfo(): Promise<WalletInfo[]> {
  // Get wallets from both networks
  const mainnetDb = new IndexedDBProvider("bitcoincash");
  const chipnetDb = new IndexedDBProvider("bchtest");

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

// Mirrors the IndexedDB lookup inside mainnet-js BaseWallet.named(), but stops after
// reading the saved walletId. Calling .named() directly would create a new wallet if missing.
export async function getNamedWalletIdFromDb(
  name: string,
  dbName: "bitcoincash" | "bchtest"
): Promise<string | undefined> {
  if (!name) throw new Error("Named wallets must have a non-empty name");

  const db = new IndexedDBProvider(dbName);
  await db.init();
  try {
    const walletEntry = await db.getWallet(name);
    return walletEntry?.wallet || undefined;
  } finally {
    await db.close();
  }
}

export async function deleteWalletFromDb(
  name: string,
  dbName: "bitcoincash" | "bchtest"
): Promise<void> {
  if (!name) throw new Error("Wallet name must be non-empty");

  // Use the same store name as IndexedDBProvider ("wallet")
  const STORE_NAME = "wallet";

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(new Error(`Failed to open database: ${dbName}`));

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        resolve();
        return;
      }

      const dbTx = db.transaction(STORE_NAME, "readwrite");
      const objectStore = dbTx.objectStore(STORE_NAME);
      const deleteRequest = objectStore.delete(name);

      deleteRequest.onsuccess = () => {
        db.close();
        resolve();
      };

      deleteRequest.onerror = () => {
        db.close();
        reject(new Error(`Failed to delete wallet: ${name}`));
      };
    };
  });
}

// For HD wallets mainnet-js keeps a derived private key per address in a database of its own,
// so deleting a wallet has to clear that too or spendable key material outlives the wallet it
// belonged to. Single-address wallets hold their key in memory and leave nothing here.
//
// Everything goes rather than the one wallet's entry, for two reasons. The entries are keyed by
// a hash of the seed rather than by the wallet name, so reproducing that derivation here would
// silently stop matching if mainnet-js ever changed it, which is a poor failure mode for
// deleting key material. And a cache entry costs only an address rescan to rebuild, so the
// price of clearing another wallet's is small and paid once.
//
// The store is cleared rather than the database deleted: deleteDatabase blocks on the open
// connection the running wallet holds, and nothing reloads the page here to close it.
export async function clearHdWalletKeyCache(): Promise<void> {
  // mainnet-js passes this one name as both the database and the object store
  const CACHE_DB = "WalletCache";

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB);

    request.onerror = () => reject(new Error(`Failed to open database: ${CACHE_DB}`));

    request.onsuccess = () => {
      const db = request.result;
      // nothing cached yet, so nothing to clear
      if (!db.objectStoreNames.contains(CACHE_DB)) {
        db.close();
        resolve();
        return;
      }

      const dbTx = db.transaction(CACHE_DB, "readwrite");
      const clearRequest = dbTx.objectStore(CACHE_DB).clear();

      clearRequest.onsuccess = () => {
        db.close();
        resolve();
      };

      clearRequest.onerror = () => {
        db.close();
        reject(new Error(`Failed to clear the HD wallet key cache`));
      };
    };
  });
}
