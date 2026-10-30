import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { binToHex, sha256, utf8ToBin } from "@bitauth/libauth";
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb";
import { BaseWallet, HDWallet, Config, DefaultProvider, deleteNamedWallet, saveNamedWallet } from "@cashonize/bch-wallet-lib";
import { pruneDeletedWalletCaches, getAllWalletsWithNetworkInfo } from "../src/utils/wallet/dbUtils";
import { openIndexedDB, getElectrumCacheSize, clearElectrumCache } from "../src/utils/cacheUtils";

// These run against a real IndexedDB implementation rather than a mock on purpose: both bugs
// this file guards against were in IndexedDB's own versioning rules, which a stub would model
// however we told it to and would have reported as passing. The wallets' browsers hold what
// mainnet-js 3.1.7 wrote, so the key format is spelled out here rather than taken from the library.

BaseWallet.StorageProvider = IndexedDBProvider;
Config.UseIndexedDBCache = true;

const CACHE_DB = "WalletCache";
const ELECTRUM_CACHE_DB = "ElectrumNetworkProviderCache";

const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const otherMnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const derivation = "m/44'/145'/0'";
const hdWalletId = (seed: string, network: string) => `hd:${network}:${seed}:${derivation}:0:0`;
// mainnet-js 3.1.7 keyed an HD wallet's cache record by a hash of its seed, derivation and network
const cacheKeyOf = (seed: string, network: string) =>
  `walletCache-${binToHex(sha256.hash(utf8ToBin(`${seed}${derivation}-${network}`)))}`;

// every test starts from a browser profile that has never run the app
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function addWallet(dbName: "bitcoincash" | "bchtest" | "bchtest4", name: string, storedWalletId: string) {
  const db = new IndexedDBProvider(dbName);
  await db.init();
  await db.addWallet(name, storedWalletId);
  await db.close();
}

// opens the key cache the way the library does, as mainnet-js did: database and store share one
// name, version 1, and the store is only ever created from the upgrade
function openLikeTheLibrary(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Failed to open ${dbName}`));
  });
}

async function seedCache(entries: [IDBValidKey, unknown][]) {
  const db = await openLikeTheLibrary(CACHE_DB);
  await new Promise<void>((resolve, reject) => {
    const objectStore = db.transaction(CACHE_DB, "readwrite").objectStore(CACHE_DB);
    for (const [key, value] of entries) objectStore.put(value, key);
    objectStore.transaction.oncomplete = () => resolve();
    objectStore.transaction.onerror = () => reject(new Error("Failed to seed the cache"));
  });
  db.close();
}

async function cacheKeys(): Promise<IDBValidKey[]> {
  const db = await openLikeTheLibrary(CACHE_DB);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction(CACHE_DB, "readonly").objectStore(CACHE_DB).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to read the cache keys"));
  });
  db.close();
  return keys;
}

// The library reads its cache through a transaction on that store, so a database left without one
// throws NotFoundError here, which takes the wallet cache's init() with it: creating or importing
// an HD wallet fails outright, for that browser profile, permanently.
async function libraryCanUseCache(dbName: string): Promise<boolean> {
  const db = await openLikeTheLibrary(dbName);
  try {
    db.transaction(dbName, "readonly");
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

// Every key in every database, so an assertion can find what the library wrote without being told
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

describe('pruneDeletedWalletCaches', () => {
  it('removes the entries of wallets that are gone and keeps the ones still in the databases', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));

    const liveMainnet = cacheKeyOf(mnemonic, "mainnet");
    const liveTestnet = cacheKeyOf(mnemonic, "testnet");
    const orphan = cacheKeyOf(otherMnemonic, "mainnet");
    await seedCache([[liveMainnet, { a: 1 }], [liveTestnet, { a: 2 }], [orphan, { a: 3 }]]);

    await pruneDeletedWalletCaches();

    const remaining = await cacheKeys();
    expect(remaining).toContain(liveMainnet);
    expect(remaining).toContain(liveTestnet);
    expect(remaining).not.toContain(orphan);
  });

  it('keeps a wallet that has only ever been used on one network', async () => {
    await addWallet("bitcoincash", "kept", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "kept", hdWalletId(mnemonic, "testnet"));
    // used on mainnet only, so no chipnet entry was ever written
    const liveMainnet = cacheKeyOf(mnemonic, "mainnet");
    await seedCache([[liveMainnet, { a: 1 }]]);

    await pruneDeletedWalletCaches();

    expect(await cacheKeys()).toEqual([liveMainnet]);
  });

  // testnet4 is registered by the app, not built into the library: a prune that does not read its
  // database, or runs before it is registered, deletes every testnet4 HD wallet's cached keys
  it('keeps the entry of a testnet4 wallet', async () => {
    await addWallet("bchtest4", "test wallet", hdWalletId(otherMnemonic, "testnet4"));
    const liveTestnet4 = cacheKeyOf(otherMnemonic, "testnet4");
    await seedCache([[liveTestnet4, { a: 1 }]]);

    await pruneDeletedWalletCaches();

    expect(await cacheKeys()).toEqual([liveTestnet4]);
  });

  it('removes every entry once the last wallet is deleted', async () => {
    const orphanOne = cacheKeyOf(mnemonic, "mainnet");
    const orphanTwo = cacheKeyOf(otherMnemonic, "mainnet");
    await seedCache([[orphanOne, { a: 1 }], [orphanTwo, { a: 2 }]]);

    await pruneDeletedWalletCaches();

    expect(await cacheKeys()).toEqual([]);
  });

  it('contributes no keys for single-address wallets, which cache nothing here', async () => {
    await addWallet("bitcoincash", "single", `seed:mainnet:${mnemonic}:${derivation}`);
    const orphan = cacheKeyOf(mnemonic, "mainnet");
    await seedCache([[orphan, { a: 1 }]]);

    await pruneDeletedWalletCaches();

    // the single-address wallet protects nothing, so the stale entry still goes
    expect(await cacheKeys()).toEqual([]);
  });

  it('leaves keys that are not strings alone', async () => {
    const orphan = cacheKeyOf(mnemonic, "mainnet");
    await seedCache([[42, { a: 1 }], [orphan, { a: 2 }]]);

    await pruneDeletedWalletCaches();

    expect(await cacheKeys()).toEqual([42]);
  });

  it('leaves a database the wallet cache can still initialise when nothing was ever cached', async () => {
    // the reachable case: every wallet is single-address, so the user deletes one and the prune
    // is the first thing ever to open this database
    await pruneDeletedWalletCaches();

    expect(await libraryCanUseCache(CACHE_DB)).toBe(true);
  });

  it('resolves without error when nothing was ever cached', async () => {
    await expect(pruneDeletedWalletCaches()).resolves.toBeUndefined();
  });
});

describe('openIndexedDB', () => {
  it('leaves a database the library can still initialise', async () => {
    // reading the cache size from the settings menu must not be able to break the electrum cache
    const db = await openIndexedDB(ELECTRUM_CACHE_DB);
    db.close();

    expect(await libraryCanUseCache(ELECTRUM_CACHE_DB)).toBe(true);
  });

  it('opens an existing database without disturbing what it holds', async () => {
    const existing = await openLikeTheLibrary(ELECTRUM_CACHE_DB);
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

// Settings' delete-all deletes this database, which waits for every connection to it to close
describe('the electrum cache size and clear', () => {
  const deleteBlocked = () => new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(ELECTRUM_CACHE_DB);
    request.onblocked = () => resolve(true);
    request.onsuccess = () => resolve(false);
  });

  it('measures the cache and leaves no connection open', async () => {
    const existing = await openLikeTheLibrary(ELECTRUM_CACHE_DB);
    await new Promise<void>((resolve) => {
      const transaction = existing.transaction(ELECTRUM_CACHE_DB, "readwrite");
      transaction.objectStore(ELECTRUM_CACHE_DB).put({ hex: "00ff" }, "tx-mainnet-aa");
      transaction.oncomplete = () => resolve();
    });
    existing.close();

    expect(await getElectrumCacheSize()).toBe(JSON.stringify({ hex: "00ff" }).length);
    expect(await deleteBlocked()).toBe(false);
  });

  it('clears the cache and leaves no connection open', async () => {
    (await openLikeTheLibrary(ELECTRUM_CACHE_DB)).close();
    await clearElectrumCache();
    expect(await deleteBlocked()).toBe(false);
  });
});

describe('deleteNamedWallet', () => {
  it('deletes the cached keys of the wallet it deletes, and no other', async () => {
    await addWallet("bitcoincash", "goes", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bitcoincash", "stays", hdWalletId(otherMnemonic, "mainnet"));
    const goes = cacheKeyOf(mnemonic, "mainnet");
    const stays = cacheKeyOf(otherMnemonic, "mainnet");
    await seedCache([[goes, { a: 1 }], [stays, { a: 2 }]]);

    await deleteNamedWallet("goes", "bitcoincash");

    expect(await cacheKeys()).toEqual([stays]);
  });

  it('removes the record it names and leaves the other wallets', async () => {
    await addWallet("bitcoincash", "goes", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bitcoincash", "stays", hdWalletId(otherMnemonic, "mainnet"));

    await deleteNamedWallet("goes", "bitcoincash");

    const db = new IndexedDBProvider("bitcoincash");
    await db.init();
    const goes = await db.getWallet("goes");
    const stays = await db.getWallet("stays");
    await db.close();

    expect(goes).toBeUndefined();
    expect(stays?.wallet).toBe(hdWalletId(otherMnemonic, "mainnet"));
  });

  // the store's deleteWallet calls this once per network, so each call has to touch only its own database
  it('leaves the same wallet on the other network alone', async () => {
    await addWallet("bitcoincash", "both", hdWalletId(mnemonic, "mainnet"));
    await addWallet("bchtest", "both", hdWalletId(mnemonic, "testnet"));

    await deleteNamedWallet("both", "bitcoincash");

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

    await expect(deleteNamedWallet("anything", "bitcoincash")).resolves.toBeUndefined();
  });

  it('leaves a database the storage provider can still add wallets to', async () => {
    // deleting from a network the wallet was never on is reachable today, since deleteWallet
    // always tries both and wallets can exist on one network only
    await deleteNamedWallet("neverExisted", "bchtest");

    const db = new IndexedDBProvider("bchtest");
    await db.init();
    await db.addWallet("later", hdWalletId(mnemonic, "testnet"));
    const stored = await db.getWallet("later");
    await db.close();

    expect(stored?.wallet).toBe(hdWalletId(mnemonic, "testnet"));
  });
});

describe('the cache key format against the library', () => {
  // The cache is found by this key in what mainnet-js 3.1.7 wrote, so the library has to keep
  // writing under it. Constructing the wallet is safe here: discovery fails on the unroutable
  // server, which the wallet survives, and nothing awaits it.
  it('stores an HD wallet\'s cache under the key mainnet-js 3.1.7 used', async () => {
    // unroutable, so a connection attempt cannot reach anything or depend on the network
    DefaultProvider.servers.mainnet = ["wss://127.0.0.1:1"];
    const wallet = await HDWallet.fromId(hdWalletId(mnemonic, "mainnet"));
    await wallet.walletCache.persist(true);
    await wallet.stop();

    const written = (await everyStoredKey()).filter((key) => key.startsWith("walletCache-"));
    expect(written).toEqual([cacheKeyOf(mnemonic, "mainnet")]);
  });

  it('prunes an entry the library wrote itself', async () => {
    DefaultProvider.servers.mainnet = ["wss://127.0.0.1:1"];
    const wallet = await HDWallet.fromId(hdWalletId(mnemonic, "mainnet"));
    await wallet.walletCache.persist(true);
    await wallet.stop();
    const written = (await everyStoredKey()).filter((key) => key.startsWith("walletCache-"));
    expect(written).toHaveLength(1);

    // no wallet records exist, so everything is orphaned
    await pruneDeletedWalletCaches();

    expect(await everyStoredKey()).not.toContain(written[0]);
  });
});

// A new wallet's chipnet copy, and both copies of an import, are stored without constructing the
// wallet; the row has to be the one mainnet-js 3.1.7 reads, in the "wallet" store keyed by name
describe('saveNamedWallet', () => {
  it('stores the row mainnet-js 3.1.7 reads, in the database it is given', async () => {
    await saveNamedWallet("saved", hdWalletId(mnemonic, "testnet"), "bchtest");

    const row = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open("bchtest");
      open.onsuccess = () => {
        const request = open.result.transaction("wallet", "readonly").objectStore("wallet").get("saved");
        request.onsuccess = () => { open.result.close(); resolve(request.result); };
        request.onerror = () => reject(new Error("Failed to read the row"));
      };
      open.onerror = () => reject(new Error("Failed to open bchtest"));
    });
    expect(row).toEqual({ name: "saved", wallet: hdWalletId(mnemonic, "testnet") });
    expect(await getAllWalletsWithNetworkInfo()).toEqual([{ name: "saved", networks: ['chipnet'] }]);
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
      .toEqual({ name: "mainnetOnly", networks: ['mainnet'] });
    expect(wallets.find((wallet) => wallet.name === "chipnetOnly"))
      .toEqual({ name: "chipnetOnly", networks: ['chipnet'] });
    expect(wallets.find((wallet) => wallet.name === "both"))
      .toEqual({ name: "both", networks: ['mainnet', 'chipnet'] });
  });

  it('lists a testnet4 wallet from its own database', async () => {
    await addWallet("bchtest4", "test wallet", hdWalletId(otherMnemonic, "testnet4"));
    expect(await getAllWalletsWithNetworkInfo()).toEqual([{ name: "test wallet", networks: ['testnet4'] }]);
  });

  it('returns nothing before any wallet exists', async () => {
    expect(await getAllWalletsWithNetworkInfo()).toEqual([]);
  });
});
