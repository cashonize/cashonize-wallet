import { IndexedDBProvider } from '@mainnet-cash/indexeddb-storage';
import { decryptWalletIdFromStorage, encryptWalletIdForStorage, isEncryptedWalletId } from './walletIdEncryption';

type WalletDbName = 'bitcoincash' | 'bchtest';

export interface MigrationStats {
  scanned: number;
  migrated: number;
  failed: number;
  failedWallets: string[];
}

const DB_NAMES: WalletDbName[] = ['bitcoincash', 'bchtest'];

export async function migrateLegacyPlaintextWalletStorage(): Promise<MigrationStats> {
  if (process.env.MODE !== 'electron') {
    return { scanned: 0, migrated: 0, failed: 0, failedWallets: [] };
  }

  const stats: MigrationStats = { scanned: 0, migrated: 0, failed: 0, failedWallets: [] };

  for (const dbName of DB_NAMES) {
    const provider = new IndexedDBProvider(dbName);
    await provider.init();
    try {
      const wallets = await provider.getWallets();
      for (const walletEntry of wallets) {
        stats.scanned += 1;
        if (isEncryptedWalletId(walletEntry.wallet)) continue;

        try {
          const encryptedWalletId = await encryptWalletIdForStorage(walletEntry.wallet);

          // Verify round-trip before mutating storage to avoid irrecoverable migration mistakes.
          const decryptedWalletId = await decryptWalletIdFromStorage(encryptedWalletId);
          if (decryptedWalletId !== walletEntry.wallet) {
            throw new Error('Encrypted wallet record failed round-trip verification');
          }

          await provider.updateWallet(walletEntry.name, encryptedWalletId);
          stats.migrated += 1;
        } catch (error) {
          stats.failed += 1;
          stats.failedWallets.push(`${dbName}:${walletEntry.name}`);
          console.error(`Failed to migrate wallet '${walletEntry.name}' in '${dbName}':`, error);
        }
      }
    } finally {
      await provider.close();
    }
  }

  return stats;
}
