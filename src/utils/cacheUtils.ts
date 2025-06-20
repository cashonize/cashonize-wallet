import Dexie from 'dexie';
import { binToHex, sha256, utf8ToBin } from 'mainnet-js';

const electrumDb = new Dexie('ElectrumNetworkProviderCache');

// version 0.1 matches 'version 1' used in indexedDb directly by mainnet-js 
electrumDb.version(0.1).stores({
  ElectrumNetworkProviderCache: ''   // key-value store
});

try {
  await electrumDb.open();
} catch (e) {
  console.error('Unable to open Electrum cache DB:', e);
}

const electrumCacheStore = electrumDb.table<string, string>('ElectrumNetworkProviderCache');

export async function getElectrumCacheSize(): Promise<number> {
  const allItems = await electrumCacheStore.toArray();
  let totalSize = 0;
  for (const item of allItems) {
    totalSize += new Blob([item]).size;
  }
  return totalSize;
}

export async function clearElectrumCache(): Promise<void> {
  await electrumCacheStore.clear();
}

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