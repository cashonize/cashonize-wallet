import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"

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
