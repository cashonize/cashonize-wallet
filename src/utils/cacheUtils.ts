import { binToHex, sha256, utf8ToBin } from 'mainnet-js';

export async function getElectrumCacheSize(): Promise<number> {
  const dbName = "ElectrumNetworkProviderCache";
  const db = await openIndexedDB(dbName);
  return await getIndexedDBObjectStoreSize(db, dbName);
}

export async function clearElectrumCache(): Promise<void> {
  const dbName = "ElectrumNetworkProviderCache";
  await clearIndexedDBObjectStore(dbName, dbName);
}

/* Native IndexedDB helper functions */
// Using Dexie caused freezing issues with Capacitor when using '.toArray' because it runs on the main thread.

export async function openIndexedDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName);
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
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        totalSize += new Blob([JSON.stringify(cursor.value)]).size;
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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => resolve();
    clearRequest.onerror = () => reject(new Error("Error clearing object store"));
  });
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

export async function cachedFetch(input: string): Promise<Response> {
  const now = Date.now();
  const cacheDuration = 7 * 24 * 60 * 60 * 1000; // 7 days

  const key = 'cachedFetch-' + binToHex(sha256.hash(utf8ToBin(input.toString())));

  const { simpleResponse, timestamp }: LocalStorageCacheResponse = JSON.parse(
    localStorage.getItem(key) || '{ "timestamp": 0, "simpleResponse": {} }'
  );

  // If item exists in localStorage and is still valid, return it
  if ((now - timestamp < cacheDuration) && simpleResponse.status) {
    // create a new Response object from the cached data
    const resp = new Response(simpleResponse.responseText, {
      status: simpleResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });

    // Set the URL property on the response object
    Object.defineProperty(resp, "url", { value: input });
    return resp;
  }

  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`Fetch ${input} failed: ${response.status} ${response.statusText}`);
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

  localStorage.setItem(`${key}`, JSON.stringify(
    {
      timestamp: now,
      simpleResponse: {
        responseText: JSON.stringify(responseData),
        status: response.status,
        url: response.url
      }
    }
  ));

  return response;
}