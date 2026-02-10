import { IndexedDBProvider } from '@mainnet-cash/indexeddb-storage';
import type { StorageProvider, WalletDbEntryI } from 'mainnet-js';
import { decryptWalletIdFromStorage, encryptWalletIdForStorage } from './walletIdEncryption';

export default class EncryptedIndexedDBProvider implements StorageProvider {
  private readonly provider: IndexedDBProvider;

  constructor(dbName = 'wallet', storeName = 'wallet') {
    this.provider = new IndexedDBProvider(dbName, storeName);
  }

  public async init() {
    await this.provider.init();
    return this;
  }

  public async close() {
    await this.provider.close();
    return this;
  }

  public getInfo() {
    return `${this.provider.getInfo()}-encrypted`;
  }

  public async addWallet(name: string, walletId: string): Promise<boolean> {
    const encryptedWalletId = await encryptWalletIdForStorage(walletId);
    return this.provider.addWallet(name, encryptedWalletId);
  }

  public async getWallet(name: string): Promise<WalletDbEntryI | undefined> {
    const walletEntry = await this.provider.getWallet(name);
    if (!walletEntry) return undefined;
    return {
      ...walletEntry,
      wallet: await decryptWalletIdFromStorage(walletEntry.wallet),
    };
  }

  public async getWallets(): Promise<Array<WalletDbEntryI>> {
    const wallets = await this.provider.getWallets();
    const decryptedWallets: WalletDbEntryI[] = [];
    for (const walletEntry of wallets) {
      decryptedWallets.push({
        ...walletEntry,
        wallet: await decryptWalletIdFromStorage(walletEntry.wallet),
      });
    }
    return decryptedWallets;
  }

  public async updateWallet(name: string, walletId: string): Promise<void> {
    const encryptedWalletId = await encryptWalletIdForStorage(walletId);
    await this.provider.updateWallet(name, encryptedWalletId);
  }

  public async walletExists(name: string): Promise<boolean> {
    return this.provider.walletExists(name);
  }
}
