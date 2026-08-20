import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage";
import { HDWallet, Wallet, Config, DefaultProvider } from "mainnet-js";
import { pruneWalletKeyCache, walletCacheKey, deleteWalletFromDb, getAllWalletsWithNetworkInfo } from "../src/utils/wallet/dbUtils";
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
const seedWalletId = (seed: string, network: string) => `seed:${network}:${seed}:${derivation}/0/0`;

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

// Every key in every database, so an assertion can find what mainnet-js wrote without being told
// where it put it. If it ever moved its cache, this still sees the entry and the prune does not.
async function everyStoredKey(): Promise<string[]> {
  const found: string[] = [];
  for (const { name } of await indexedDB.databases()) {
    if (!name) continue;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to open ${name}`));
    });
    for (const storeName of [...db.objectStoreNames]) {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(`Failed to read ${name}`));
      });
      for (const key of keys) if (typeof key === "string") found.push(key);
    }
    db.close();
  }
  return found;
}

describe('pruneWalletKeyCache', () => {
  it('removes the entries of wallets that are gone and keeps the ones still in the databases', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));

    const liveMainnet = walletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    const liveTestnet = walletCacheKey(hdWalletId(mnemonic, "testnet")) as string;
    const orphan = walletCacheKey(hdWalletId(otherMnemonic, "mainnet")) as string;
    await seedCache([[liveMainnet, { a: 1 }], [liveTestnet, { a: 2 }], [orphan, { a: 3 }]]);

    await pruneWalletKeyCache();

    const remaining = await cacheKeys();
    expect(remaining).toContain(liveMainnet);
    expect(remaining).toContain(liveTestnet);
    expect(remaining).not.toContain(orphan);
  });

  it('keeps a wallet that has only ever been used on one network', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));
    // used on mainnet only, so no chipnet entry was ever written
    const liveMainnet = walletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    await seedCache([[liveMainnet, { a: 1 }]]);

    await pruneWalletKeyCache();

    expect(await cacheKeys()).toEqual([liveMainnet]);
  });

  it('removes every entry once the last wallet is deleted', async () => {
    const orphanOne = walletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    const orphanTwo = walletCacheKey(hdWalletId(otherMnemonic, "mainnet")) as string;
    await seedCache([[orphanOne, { a: 1 }], [orphanTwo, { a: 2 }]]);

    await pruneWalletKeyCache();

    expect(await cacheKeys()).toEqual([]);
  });

  it('keeps the entry of a single-address wallet still in the databases', async () => {
    await addWallet("bitcoincash", "single", seedWalletId(mnemonic, "mainnet"));
    const liveSingle = walletCacheKey(seedWalletId(mnemonic, "mainnet")) as string;
    const orphan = walletCacheKey(hdWalletId(otherMnemonic, "mainnet")) as string;
    await seedCache([[liveSingle, { a: 1 }], [orphan, { a: 2 }]]);

    await pruneWalletKeyCache();

    expect(await cacheKeys()).toEqual([liveSingle]);
  });

  it('leaves keys that are not mainnet-js strings alone', async () => {
    const orphan = walletCacheKey(hdWalletId(mnemonic, "mainnet")) as string;
    await seedCache([[42, { a: 1 }], [orphan, { a: 2 }]]);

    await pruneWalletKeyCache();

    expect(await cacheKeys()).toEqual([42]);
  });

  it('leaves a database mainnet-js can still initialise when nothing was ever cached', async () => {
    // the reachable case: every wallet is single-address, so the user deletes one and the prune
    // is the first thing ever to open this database
    await pruneWalletKeyCache();

    expect(await mainnetJsCanUseCache(CACHE_DB)).toBe(true);
  });

  it('resolves without error when nothing was ever cached', async () => {
    await expect(pruneWalletKeyCache()).resolves.toBeUndefined();
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
  // This one goes through IndexedDBProvider itself, which asks for its own version and creates
  // its store during the upgrade, so a database someone else left behind still ends up usable
  it('removes the record it names and leaves the other wallets', async () => {
    await addWallet("bitcoincash", "goes", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bitcoincash", "stays", hdWalletId(otherMnemonic, "mainnet"));

    await deleteWalletFromDb("goes", "bitcoincash");

    const db = new IndexedDBProvider("bitcoincash");
    await db.init();
    const goes = await db.getWallet("goes");
    const stays = await db.getWallet("stays");
    await db.close();

    expect(goes).toBeUndefined();
    expect(stays?.wallet).toBe(hdWalletId(otherMnemonic, "mainnet"));
  });

  // deleteWallet calls this once per network, so each call has to touch only its own database
  it('leaves the same wallet on the other network alone', async () => {
    await addWallet("bitcoincash", "both", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "both", hdWalletId(mnemonic, "testnet"));

    await deleteWalletFromDb("both", "bitcoincash");

    const mainnetDb = new IndexedDBProvider("bitcoincash");
    const chipnetDb = new IndexedDBProvider("bchtest");
    await Promise.all([mainnetDb.init(), chipnetDb.init()]);
    const fromMainnet = await mainnetDb.getWallet("both");
    const fromChipnet = await chipnetDb.getWallet("both");
    await Promise.all([mainnetDb.close(), chipnetDb.close()]);

    expect(fromMainnet).toBeUndefined();
    expect(fromChipnet?.wallet).toBe(hdWalletId(mnemonic, "testnet"));
  });

  // a database left without the wallet store holds no record to remove, so resolving is the
  // honest answer rather than a failure
  it('resolves when the database has no wallet store', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bitcoincash", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Failed to open bitcoincash"));
    });
    expect([...db.objectStoreNames]).toEqual([]);
    db.close();

    await expect(deleteWalletFromDb("anything", "bitcoincash")).resolves.toBeUndefined();
  });

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

describe('walletCacheKey against mainnet-js', () => {
  // The derivations mirror private ones, so this is the contract that would otherwise break
  // silently on a version bump. Constructing the wallets is safe here: initialize() sets the
  // cache key and awaits only the cache, leaving address watching unawaited, so the offline
  // wedge that catches consumers of watchPromise does not catch this.
  it('derives the key mainnet-js will store an HD wallet entry under', async () => {
    Config.UseIndexedDBCache = true;
    // unroutable, so a connection attempt cannot reach anything or depend on the network
    DefaultProvider.servers.mainnet = "wss://127.0.0.1:1";
    const storedWalletId = hdWalletId(mnemonic, "mainnet");

    const wallet = await HDWallet.fromId(storedWalletId);

    expect(walletCacheKey(storedWalletId)).toBe(`walletCache-${wallet.walletId}`);
  });

  it('derives the key mainnet-js will store a single-address wallet entry under', async () => {
    Config.UseIndexedDBCache = true;
    DefaultProvider.servers.mainnet = "wss://127.0.0.1:1";
    const storedWalletId = seedWalletId(mnemonic, "mainnet");

    const wallet = await Wallet.fromId(storedWalletId);
    // let mainnet-js write the entry through its own database name, store name and key prefix,
    // so none of those are assumed here. Only the immediate persist awaits its own write.
    await wallet.walletCache.persist(true);

    const written = (await everyStoredKey()).filter((key) => key.startsWith("walletCache-"));
    expect(written).toEqual([walletCacheKey(storedWalletId)]);
  });
});

describe('getAllWalletsWithNetworkInfo', () => {
  // The flags decide which network a fallback wallet loads on at startup, so getting one of them
  // backwards would open the wrong chain rather than merely mislabel a list
  it('reports each wallet once, with the networks it exists on', async () => {
    await addWallet("bitcoincash", "mainnetOnly", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "chipnetOnly", hdWalletId(mnemonic, "testnet"));
    await addWallet("bitcoincash", "both", hdWalletId(otherMnemonic, "mainnet"));
    await addWallet("bchtest", "both", hdWalletId(otherMnemonic, "testnet"));

    const wallets = await getAllWalletsWithNetworkInfo();

    expect(wallets).toHaveLength(3);
    expect(wallets.find((wallet) => wallet.name === "mainnetOnly"))
      .toEqual({ name: "mainnetOnly", hasMainnet: true, hasChipnet: false });
    expect(wallets.find((wallet) => wallet.name === "chipnetOnly"))
      .toEqual({ name: "chipnetOnly", hasMainnet: false, hasChipnet: true });
    expect(wallets.find((wallet) => wallet.name === "both"))
      .toEqual({ name: "both", hasMainnet: true, hasChipnet: true });
  });

  it('returns nothing before any wallet exists', async () => {
    expect(await getAllWalletsWithNetworkInfo()).toEqual([]);
  });
});

describe('pruneWalletKeyCache against mainnet-js', () => {
  it('removes an entry mainnet-js wrote itself', async () => {
    Config.UseIndexedDBCache = true;
    DefaultProvider.servers.mainnet = "wss://127.0.0.1:1";
    const wallet = await HDWallet.fromId(hdWalletId(mnemonic, "mainnet"));
    // let mainnet-js write the entry through its own database name, store name and key prefix,
    // so none of those are assumed here. Only the immediate persist awaits its own write.
    await wallet.walletCache.persist(true);
    const written = (await everyStoredKey()).filter((key) => key.startsWith("walletCache-"));
    expect(written).toHaveLength(1);

    // no wallet records exist, so everything is orphaned
    await pruneWalletKeyCache();

    expect(await everyStoredKey()).not.toContain(written[0]);
  });
});
