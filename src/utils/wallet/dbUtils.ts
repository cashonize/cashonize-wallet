import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import {
  assertSuccess,
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  deriveSeedFromBip39Mnemonic,
  encodeCashAddress,
  hash160,
  sha256,
  utf8ToBin
} from "@bitauth/libauth"

export interface WalletInfo {
  name: string;
  hasMainnet: boolean;
  hasChipnet: boolean;
}

//-----------------------------------------------------------------------------
// Through mainnet-js's own storage provider
//-----------------------------------------------------------------------------
// IndexedDBProvider is mainnet-js's own class, so the database name, its version and the shape
// of a record stay its business. Only the layer above it is bypassed, for the reasons below.

// BaseWallet.namedExists reads the same record, but constructs a wallet to get there, and that
// builds an electrum client and network provider, which becomes the session's global one when
// there is none yet.
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

// mainnet-js has no wallet listing above the storage provider, so this uses its getWallets().
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

// mainnet-js's getNamedWalletId reads the same record, but throws when the name is not in that
// database. A wallet legitimately exists on one network only, so the caller needs that returned.
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

// Deleting a record is part of the StorageProvider interface since mainnet-js v4, so this stays
// its business too. Deleting from a database the wallet was never in resolves as a no-op.
export async function deleteWalletFromDb(
  name: string,
  dbName: "bitcoincash" | "bchtest"
): Promise<void> {
  if (!name) throw new Error("Wallet name must be non-empty");

  const db = new IndexedDBProvider(dbName);
  await db.init();
  try {
    await db.deleteWallet(name);
  } finally {
    await db.close();
  }
}

//-----------------------------------------------------------------------------
// Wallet key cache (Raw IndexedDB)
//-----------------------------------------------------------------------------
// Everything above works on the mainnet-js wallet databases, everything below on the separate
// one holding its wallet cache.
//
// mainnet-js keeps derived private keys in a database of its own: one entry per address for HD
// wallets, and one for the wallet itself for single-address wallets. Deleting a wallet has to
// clear those too or spendable key material outlives the wallet it belonged to.
//
// mainnet-js does not export the class it reads that database with, and it could not list what
// it holds anyway, which the prune needs.

// mainnet-js keys those entries by a hash of the wallet's secrets rather than by the wallet
// name, so the key has to be rebuilt from the stored wallet record. Mirrors the wallets' own
// derivations for the record kinds the app creates (hd and seed); anything else matches nothing.
export function walletCacheKey(storedWalletId: string): string | undefined {
  const [walletType, network, secret, fourthField] = storedWalletId.split(":");
  if (!network || !secret) return undefined;

  if (walletType === "hd") {
    // mnemonic wallets store the derivation path after the mnemonic and hash the two together,
    // xpriv and xpub wallets hash the key on its own
    const seedSource = fourthField?.startsWith("m/") ? secret + fourthField : secret;
    return `walletCache-${binToHex(sha256.hash(utf8ToBin(`${seedSource}-${network}`)))}`;
  }

  if (walletType === "seed") {
    // single-address wallets hash their cash address, so derive it from the stored mnemonic and
    // derivation path the way the wallet itself does
    if (!fourthField?.startsWith("m/")) return undefined;
    if (network !== "mainnet" && network !== "testnet") return undefined;
    const rootNode = deriveHdPrivateNodeFromSeed(deriveSeedFromBip39Mnemonic(secret));
    const addressNode = deriveHdPath(rootNode, fourthField);
    const publicKeyHash = hash160(deriveHdPublicNode(addressNode).publicKey);
    const prefix = network === "mainnet" ? "bitcoincash" : "bchtest";
    const cashaddr = assertSuccess(encodeCashAddress({ prefix, type: "p2pkh", payload: publicKeyHash })).address;
    return `walletCache-${binToHex(sha256.hash(utf8ToBin(`${cashaddr}-${network}`)))}`;
  }

  return undefined;
}

// Every wallet's stored id, from both databases. The prune needs these to work out which cached
// keys still belong to a wallet. Each database is read once, since getWallets already returns the
// stored id next to the name.
async function getAllStoredWalletIds(): Promise<string[]> {
  const mainnetDb = new IndexedDBProvider("bitcoincash");
  const chipnetDb = new IndexedDBProvider("bchtest");
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

// Deletes the cached keys of every wallet that is no longer in the databases. Deleting a wallet
// left these keys behind up to and including v0.12, so working from the wallets that remain
// rather than from the one just deleted is what clears those too, and matching no current wallet
// is the expected state for anyone upgrading rather than a sign something is wrong.
//
// Keys are deleted one at a time rather than the database dropped, because deleteDatabase waits
// on the connection the running wallet holds open and nothing reloads the page here to close it.
export async function pruneWalletKeyCache(): Promise<void> {
  // mainnet-js passes this one name as both the database and the object store
  const CACHE_DB = "WalletCache";

  const liveCacheKeys: string[] = [];
  for (const storedWalletId of await getAllStoredWalletIds()) {
    const cacheKey = walletCacheKey(storedWalletId);
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
      // a fresh database gets its store from the upgrade above, so reaching here means something
      // else left this one without one. Adding it now would take a version mainnet-js never asks
      // for, so the only safe move is to leave it be.
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
