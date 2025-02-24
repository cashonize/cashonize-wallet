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
