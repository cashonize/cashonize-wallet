import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage";
import { pruneHdWalletKeyCache, hdWalletCacheKey, deleteWalletFromDb } from "../src/utils/wallet/dbUtils";
import { openIndexedDB } from "../src/utils/cacheUtils";

// These run against a real IndexedDB implementation rather than a mock on purpose: both bugs
// this file guards against were in IndexedDB's own versioning rules, which a stub would model
// however we told it to and would have reported as passing.

const CACHE_DB = "WalletCache";
const ELECTRUM_CACHE_DB = "ElectrumNetworkProviderCache";

const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const otherMnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const derivation = "m/44'/145'/0'";
const hdWalletId = (seed: string, network: string) => `hd:${network}:${seed}:${derivation}:0:0`;

// every test starts from a browser profile that has never run the app
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function addWallet(dbName: "bitcoincash" | "bchtest", name: string, storedWalletId: string) {
  const db = new IndexedDBProvider(dbName);
  await db.init();
  await db.addWallet(name, storedWalletId);
  await db.close();
}

// opens the key cache the way mainnet-js does: database and store share one name, version 1,
// and the store is only ever created from the upgrade
function openLikeMainnetJs(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Failed to open ${dbName}`));
  });
}

async function seedCache(entries: [IDBValidKey, unknown][]) {
  const db = await openLikeMainnetJs(CACHE_DB);
  await new Promise<void>((resolve, reject) => {
    const objectStore = db.transaction(CACHE_DB, "readwrite").objectStore(CACHE_DB);
    for (const [key, value] of entries) objectStore.put(value, key);
    objectStore.transaction.oncomplete = () => resolve();
    objectStore.transaction.onerror = () => reject(new Error("Failed to seed the cache"));
  });
  db.close();
}

async function cacheKeys(): Promise<IDBValidKey[]> {
  const db = await openLikeMainnetJs(CACHE_DB);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction(CACHE_DB, "readonly").objectStore(CACHE_DB).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to read the cache keys"));
  });
  db.close();
  return keys;
}

// mainnet-js reads its cache through a transaction on that store, so a database left without one
// throws NotFoundError here. Its own try/catch covers only the JSON parse, so the throw takes
// PersistentWalletCache.init() with it and creating or importing an HD wallet fails outright,
// for that browser profile, permanently.
async function mainnetJsCanUseCache(dbName: string): Promise<boolean> {
  const db = await openLikeMainnetJs(dbName);
  try {
    db.transaction(dbName, "readonly");
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

describe('pruneHdWalletKeyCache', () => {
  it('removes the entries of wallets that are gone and keeps the ones still in the databases', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));

    const liveMainnet = hdWalletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    const liveTestnet = hdWalletCacheKey(hdWalletId(mnemonic, "testnet")) as string;
    const orphan = hdWalletCacheKey(hdWalletId(otherMnemonic, "mainnet")) as string;
    await seedCache([[liveMainnet, { a: 1 }], [liveTestnet, { a: 2 }], [orphan, { a: 3 }]]);

    await pruneHdWalletKeyCache();

    const remaining = await cacheKeys();
    expect(remaining).toContain(liveMainnet);
    expect(remaining).toContain(liveTestnet);
    expect(remaining).not.toContain(orphan);
  });

  it('keeps a wallet that has only ever been used on one network', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));
    // used on mainnet only, so no chipnet entry was ever written
    const liveMainnet = hdWalletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    await seedCache([[liveMainnet, { a: 1 }]]);

    await pruneHdWalletKeyCache();

    expect(await cacheKeys()).toEqual([liveMainnet]);
  });

  it('removes every entry once the last wallet is deleted', async () => {
    const orphanOne = hdWalletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    const orphanTwo = hdWalletCacheKey(hdWalletId(otherMnemonic, "mainnet")) as string;
    await seedCache([[orphanOne, { a: 1 }], [orphanTwo, { a: 2 }]]);

    await pruneHdWalletKeyCache();

    expect(await cacheKeys()).toEqual([]);
  });

  it('contributes no keys for single-address wallets, which cache nothing here', async () => {
    await addWallet("bitcoincash", "single", `seed:mainnet:${mnemonic}:${derivation}`);
    const orphan = hdWalletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    await seedCache([[orphan, { a: 1 }]]);

    await pruneHdWalletKeyCache();

    // the single-address wallet protects nothing, so the stale entry still goes
    expect(await cacheKeys()).toEqual([]);
  });

  it('leaves keys that are not mainnet-js strings alone', async () => {
    const orphan = hdWalletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    await seedCache([[42, { a: 1 }], [orphan, { a: 2 }]]);

    await pruneHdWalletKeyCache();

    expect(await cacheKeys()).toEqual([42]);
  });

  it('leaves a database mainnet-js can still initialise when nothing was ever cached', async () => {
    // the reachable case: every wallet is single-address, so the user deletes one and the prune
    // is the first thing ever to open this database
    await pruneHdWalletKeyCache();

    expect(await mainnetJsCanUseCache(CACHE_DB)).toBe(true);
  });

  it('resolves without error when nothing was ever cached', async () => {
    await expect(pruneHdWalletKeyCache()).resolves.toBeUndefined();
  });
});

describe('openIndexedDB', () => {
  it('leaves a database mainnet-js can still initialise', async () => {
    // reading the cache size from the settings menu must not be able to break the electrum cache
    const db = await openIndexedDB(ELECTRUM_CACHE_DB);
    db.close();

    expect(await mainnetJsCanUseCache(ELECTRUM_CACHE_DB)).toBe(true);
  });

  it('opens an existing database without disturbing what it holds', async () => {
    const existing = await openLikeMainnetJs(ELECTRUM_CACHE_DB);
    await new Promise<void>((resolve) => {
      const objectStore = existing.transaction(ELECTRUM_CACHE_DB, "readwrite").objectStore(ELECTRUM_CACHE_DB);
      objectStore.put("cached", "header-mainnet-800000-false");
      objectStore.transaction.oncomplete = () => resolve();
    });
    existing.close();

    const db = await openIndexedDB(ELECTRUM_CACHE_DB);
    const value = await new Promise((resolve) => {
      const request = db.transaction(ELECTRUM_CACHE_DB, "readonly")
        .objectStore(ELECTRUM_CACHE_DB).get("header-mainnet-800000-false");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();

    expect(value).toBe("cached");
  });
});

describe('deleteWalletFromDb', () => {
  // This one opens without a version, unlike the caches, and is only safe because
  // IndexedDBProvider asks for 31: a database created here at version 1 still gets its upgrade,
  // and its store, when mainnet-js next opens it
  it('leaves a database mainnet-js can still add wallets to', async () => {
    // deleting from a network the wallet was never on is reachable today, since deleteWallet
    // always tries both and wallets can exist on one network only
    await deleteWalletFromDb("neverExisted", "bchtest");

    const db = new IndexedDBProvider("bchtest");
    await db.init();
    await db.addWallet("later", hdWalletId(mnemonic, "testnet"));
    const stored = await db.getWallet("later");
    await db.close();

    expect(stored?.wallet).toBe(hdWalletId(mnemonic, "testnet"));
  });
});
