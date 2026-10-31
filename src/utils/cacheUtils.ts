import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { isQuotaExceededError } from 'src/utils/errorHandling';

const CACHE_TTL_DAYS = 7;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
// A server that accepts the connection and never answers would otherwise hold whatever awaited
// the fetch for the browser's own timeout, minutes on some; the wallet init awaits these
const CACHED_FETCH_TIMEOUT_MS = 15_000;

// Whether a result kept with the key it was looked up for still answers a lookup for `key`
export function isFreshLookup(lookup: { key: string, at: number } | undefined, key: string, ttlMs: number): boolean {
  return lookup?.key === key && Date.now() - lookup.at < ttlMs;
}

export async function getElectrumCacheSize(): Promise<number> {
  const dbName = "ElectrumNetworkProviderCache";
  const db = await openIndexedDB(dbName);
  try {
    return await getIndexedDBObjectStoreSize(db, dbName);
  } finally {
    db.close();
  }
}

export async function clearElectrumCache(): Promise<void> {
  const dbName = "ElectrumNetworkProviderCache";
  await clearIndexedDBObjectStore(dbName, dbName);
}

/* Native IndexedDB helper functions */

// Object stores can only be created during an upgrade, which runs only when the version asked
// for is higher than the one stored. Opening without a version creates this database at version
// 1 with no store, and the library opens its caches at version 1 too, so it would never upgrade
// and never add its own. Match its version and create the store, which it names after the database.
export async function openIndexedDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName, 1);
    openRequest.onupgradeneeded = () => openRequest.result.createObjectStore(dbName);
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(new Error("Error opening IndexedDB"));
  });
}

export async function getIndexedDBObjectStoreSize(
  db: IDBDatabase,
  storeName: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    let totalSize = 0;
    const dbTx = db.transaction(storeName, "readonly");
    const objectStore = dbTx.objectStore(storeName);
    const cursorRequest = objectStore.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        // characters rather than bytes: the cached transactions and headers are hex and ASCII JSON
        totalSize += JSON.stringify(cursor.value).length;
        cursor.continue();
      } else {
        resolve(totalSize);
      }
    };

    cursorRequest.onerror = () => reject(new Error("Error reading IndexedDB"));
  });
}

export async function clearIndexedDBObjectStore(dbName: string, storeName: string): Promise<void> {
  const db = await openIndexedDB(dbName);
  try {
    await new Promise<void>((resolve, reject) => {
      const dbTx = db.transaction(storeName, "readwrite");
      const objectStore = dbTx.objectStore(storeName);
      const clearRequest = objectStore.clear();

      clearRequest.onsuccess = () => resolve();
      clearRequest.onerror = () => reject(new Error("Error clearing object store"));
    });
  } finally {
    db.close();
  }
}

/* cachedFetch implementation using localStorage */

interface LocalStorageCacheResponse {
  simpleResponse: {
    responseText: string,
    status: number,
    url: string
  },
  timestamp: number
}

const CACHED_FETCH_PREFIX = 'cachedFetch-';

// A corrupt entry reads as a miss, so it is fetched again and overwritten
function readCacheEntry(key: string): LocalStorageCacheResponse | undefined {
  const stored = localStorage.getItem(key);
  if (!stored) return undefined;
  try {
    return JSON.parse(stored) as LocalStorageCacheResponse;
  } catch {
    return undefined;
  }
}

// Expiry is only checked on read, so entries nobody asks for again stay until the store is full.
// The ttl a caller passed is not stored with the entry, so the default one decides what is expired.
function removeExpiredCacheEntries(now: number) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHED_FETCH_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const timestamp = readCacheEntry(key)?.timestamp;
    if (typeof timestamp !== 'number' || now - timestamp >= CACHE_TTL_MS) localStorage.removeItem(key);
  }
}

export async function cachedFetch(input: string, ttlMs: number = CACHE_TTL_MS): Promise<Response> {
  const now = Date.now();
  const key = CACHED_FETCH_PREFIX + binToHex(sha256.hash(utf8ToBin(input.toString())));

  const cached = readCacheEntry(key);

  // If item exists in localStorage and is still valid, return it
  if (cached?.simpleResponse?.status && now - cached.timestamp < ttlMs) {
    const { simpleResponse } = cached;
    // create a new Response object from the cached data
    const resp = new Response(simpleResponse.responseText, {
      status: simpleResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });

    // Set the URL property on the response object
    Object.defineProperty(resp, "url", { value: input });
    return resp;
  }

  // attach url to error if fetch fails
  const response = await fetch(input, { signal: AbortSignal.timeout(CACHED_FETCH_TIMEOUT_MS) }).catch(err => {
    err.url = input;
    throw err;
  });

  if (!response.ok) {
    const err = new Error(`Fetch ${input} failed: ${response.status} ${response.statusText}`)
    type extendedError = Error & { url?: string };
    (err as extendedError).url = response.url || input;
    throw err;
  }
  const clonedResponse = response.clone();
  let shouldCache = true;
  let responseData;
  try {
    responseData = await clonedResponse.json()
    if ('error' in responseData) {
      shouldCache = false;
    }
  } catch (e) {
    console.error("Error parsing API response as JSON:", e);
    shouldCache = false;
  }
  if(!shouldCache) return response

  const entry = JSON.stringify({
    timestamp: now,
    simpleResponse: {
      responseText: JSON.stringify(responseData),
      status: response.status,
      url: response.url
    }
  });
  // A full localStorage loses the cache entry, not the response
  try {
    localStorage.setItem(key, entry);
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.error("Failed to cache fetch response:", error);
      return response;
    }
    removeExpiredCacheEntries(now);
    try {
      localStorage.setItem(key, entry);
    } catch (retryError) {
      console.error("Failed to cache fetch response, storage is full:", retryError);
    }
  }

  return response;
}