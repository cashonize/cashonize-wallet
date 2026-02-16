import { beforeEach, describe, expect, it, vi } from 'vitest';

type WalletEntry = { name: string; wallet: string };

const hoisted = vi.hoisted(() => ({
  mockEncryptWalletIdForStorage: vi.fn(),
  mockDecryptWalletIdFromStorage: vi.fn(),
  providerData: [] as WalletEntry[],
}));

vi.mock('@mainnet-cash/indexeddb-storage', () => ({
  IndexedDBProvider: class {
    async init() {}

    async close() {}

    getInfo() {
      return 'mock-indexeddb';
    }

    async addWallet(name: string, wallet: string) {
      hoisted.providerData.push({ name, wallet });
      return true;
    }

    async getWallet(name: string) {
      const entry = hoisted.providerData.find((wallet) => wallet.name === name);
      return entry ? { ...entry } : undefined;
    }

    async getWallets() {
      return hoisted.providerData.map((entry) => ({ ...entry }));
    }

    async updateWallet(name: string, wallet: string) {
      const idx = hoisted.providerData.findIndex((entry) => entry.name === name);
      if (idx !== -1) {
        hoisted.providerData[idx] = { name, wallet };
      }
    }

    async walletExists(name: string) {
      return hoisted.providerData.some((entry) => entry.name === name);
    }
  },
}));

vi.mock('../../src/security/walletIdEncryption', () => ({
  encryptWalletIdForStorage: hoisted.mockEncryptWalletIdForStorage,
  decryptWalletIdFromStorage: hoisted.mockDecryptWalletIdFromStorage,
}));

import EncryptedIndexedDBProvider from '../../src/security/EncryptedIndexedDBProvider';

describe('EncryptedIndexedDBProvider', () => {
  beforeEach(() => {
    hoisted.providerData.length = 0;
    vi.clearAllMocks();
    hoisted.mockEncryptWalletIdForStorage.mockImplementation(async (walletId: string) => `enc-v1:${walletId}`);
    hoisted.mockDecryptWalletIdFromStorage.mockImplementation(async (walletId: string) => walletId.replace(/^enc-v1:/, ''));
  });

  it('addWallet and getWallet round-trip through encryption/decryption', async () => {
    const provider = new EncryptedIndexedDBProvider();

    await provider.addWallet('alice', 'seed:mainnet:one two three');
    const result = await provider.getWallet('alice');

    expect(result).toEqual({ name: 'alice', wallet: 'seed:mainnet:one two three' });
    expect(hoisted.providerData[0]?.wallet).toBe('enc-v1:seed:mainnet:one two three');
  });

  it('getWallets returns all decrypted wallets', async () => {
    const provider = new EncryptedIndexedDBProvider();
    await provider.addWallet('alice', 'seed:mainnet:aaa');
    await provider.addWallet('bob', 'hd:testnet:bbb');

    const wallets = await provider.getWallets();

    expect(wallets).toEqual([
      { name: 'alice', wallet: 'seed:mainnet:aaa' },
      { name: 'bob', wallet: 'hd:testnet:bbb' },
    ]);
  });

  it('updateWallet overwrites stored encrypted value', async () => {
    const provider = new EncryptedIndexedDBProvider();
    await provider.addWallet('alice', 'seed:mainnet:old');

    await provider.updateWallet('alice', 'seed:mainnet:new');
    const result = await provider.getWallet('alice');

    expect(hoisted.providerData[0]?.wallet).toBe('enc-v1:seed:mainnet:new');
    expect(result?.wallet).toBe('seed:mainnet:new');
  });

  it('walletExists works independently from decryption path', async () => {
    const provider = new EncryptedIndexedDBProvider();
    await provider.addWallet('alice', 'seed:mainnet:test');

    const exists = await provider.walletExists('alice');

    expect(exists).toBe(true);
    expect(hoisted.mockDecryptWalletIdFromStorage).not.toHaveBeenCalled();
  });
});
