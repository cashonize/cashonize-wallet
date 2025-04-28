import Dexie from 'dexie';

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
