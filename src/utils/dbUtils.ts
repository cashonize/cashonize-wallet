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
