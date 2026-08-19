import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import { binToHex, sha256, utf8ToBin } from "@bitauth/libauth"

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

//-----------------------------------------------------------------------------
// HD wallet key cache
//-----------------------------------------------------------------------------
// Everything above works on the mainnet-js wallet databases, everything below on the separate
// one holding its HD address cache.
//
// For HD wallets mainnet-js keeps a derived private key per address in a database of its own,
// so deleting a wallet has to clear that too or spendable key material outlives the wallet it
// belonged to. Single-address wallets hold their key in memory and leave nothing here.

// mainnet-js keys those entries by a hash of the seed rather than by the wallet name, so the key
// has to be rebuilt from the stored wallet record. Mirrors HDWallet's own derivation.
export function hdWalletCacheKey(storedWalletId: string): string | undefined {
  const [walletType, network, secret, fourthField] = storedWalletId.split(":");
  if (walletType !== "hd" || !network || !secret) return undefined;
  // mnemonic wallets store the derivation path after the mnemonic and hash the two together,
  // xpriv and xpub wallets hash the key on its own
  const seedSource = fourthField?.startsWith("m/") ? secret + fourthField : secret;
  const walletId = binToHex(sha256.hash(utf8ToBin(`${seedSource}-${network}`)));
  return `walletCache-${walletId}`;
}

// Every wallet's stored id, both networks, for callers matching records that are keyed by
// wallet rather than by name
export async function getAllStoredWalletIds(): Promise<string[]> {
  const wallets = await getAllWalletsWithNetworkInfo();
  const lookups: Promise<string | undefined>[] = [];
  for (const wallet of wallets) {
    if (wallet.hasMainnet) lookups.push(getNamedWalletIdFromDb(wallet.name, "bitcoincash"));
    if (wallet.hasChipnet) lookups.push(getNamedWalletIdFromDb(wallet.name, "bchtest"));
  }
  const storedIds = await Promise.all(lookups);
  return storedIds.filter((storedId): storedId is string => storedId !== undefined);
}

// Drops every cache entry that belongs to no wallet still in the databases. Pruning against the
// wallets that remain, rather than deleting the entries of the one that just went, is what lets
// this also collect what earlier deletions orphaned, from before anything cleaned up here at all.
//
// It degrades safely too: if hdWalletCacheKey ever stopped agreeing with mainnet-js, every entry
// would look orphaned and be dropped, costing an address rescan rather than leaving keys behind.
//
// The entries go one by one rather than the database being deleted, since deleteDatabase blocks
// on the open connection the running wallet holds and nothing reloads the page here to close it.
export async function pruneHdWalletKeyCache(): Promise<void> {
  // mainnet-js passes this one name as both the database and the object store
  const CACHE_DB = "WalletCache";

  const liveCacheKeys: string[] = [];
  for (const storedWalletId of await getAllStoredWalletIds()) {
    const cacheKey = hdWalletCacheKey(storedWalletId);
    if (cacheKey) liveCacheKeys.push(cacheKey);
  }

  return new Promise((resolve, reject) => {
    // Object stores can only be created during an upgrade, which runs only when the version
    // asked for is higher than the one stored. Opening without a version creates this database
    // at version 1 with no store, and mainnet-js only ever asks for version 1, so it would never
    // upgrade and never get to add its own. Match its version and create the store too.
    const request = indexedDB.open(CACHE_DB, 1);

    request.onerror = () => reject(new Error(`Failed to open database: ${CACHE_DB}`));

    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_DB);

    request.onsuccess = () => {
      const db = request.result;
      // nothing has ever been cached, so nothing to prune
      if (!db.objectStoreNames.contains(CACHE_DB)) {
        db.close();
        resolve();
        return;
      }

      const objectStore = db.transaction(CACHE_DB, "readwrite").objectStore(CACHE_DB);
      const keysRequest = objectStore.getAllKeys();

      keysRequest.onerror = () => {
        db.close();
        reject(new Error("Failed to read the HD wallet key cache"));
      };

      keysRequest.onsuccess = () => {
        // anything that is not one of mainnet-js's string keys is left alone rather than
        // deleted, since it is not ours to interpret
        const orphaned = keysRequest.result.filter(
          (cacheKey) => typeof cacheKey === "string" && !liveCacheKeys.includes(cacheKey)
        );
        for (const cacheKey of orphaned) {
          objectStore.delete(cacheKey);
        }
        // the transaction carries the deletes, so wait on it rather than on each request
        objectStore.transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        objectStore.transaction.onerror = () => {
          db.close();
          reject(new Error("Failed to prune the HD wallet key cache"));
        };
      };
    };
  });
}
