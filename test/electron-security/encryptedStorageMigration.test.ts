import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProcessMode, silenceConsoleError } from '../mocks/electronSecurityMocks';

type WalletEntry = { name: string; wallet: string };

const hoisted = vi.hoisted(() => ({
  mockEncryptWalletIdForStorage: vi.fn(),
  mockDecryptWalletIdFromStorage: vi.fn(),
  mockDbData: {
    bitcoincash: [] as WalletEntry[],
    bchtest: [] as WalletEntry[],
  } as Record<string, WalletEntry[]>,
}));

function getDb(dbName: string): WalletEntry[] {
  return hoisted.mockDbData[dbName] ?? [];
}

vi.mock('@mainnet-cash/indexeddb-storage', () => ({
  IndexedDBProvider: class {
    private readonly dbName: string;

    constructor(dbName: string) {
      this.dbName = dbName;
    }

    async init() {}

    async close() {}

    async getWallets() {
      return getDb(this.dbName).map((entry) => ({ ...entry }));
    }

    async updateWallet(name: string, wallet: string) {
      const db = getDb(this.dbName);
      const idx = db.findIndex((entry) => entry.name === name);
      if (idx !== -1) {
        db[idx] = { name, wallet };
        hoisted.mockDbData[this.dbName] = db;
      }
    }
  },
}));

vi.mock('../../src/security/walletIdEncryption', () => ({
  isEncryptedWalletId: (walletId: string) => walletId.startsWith('enc-v1:'),
  encryptWalletIdForStorage: hoisted.mockEncryptWalletIdForStorage,
  decryptWalletIdFromStorage: hoisted.mockDecryptWalletIdFromStorage,
}));

import { migrateLegacyPlaintextWalletStorage } from '../../src/security/encryptedStorageMigration';

describe('encryptedStorageMigration', () => {
  const originalMode = process.env.MODE;

  beforeEach(() => {
    setProcessMode('electron');
    hoisted.mockDbData.bitcoincash = [];
    hoisted.mockDbData.bchtest = [];
    vi.clearAllMocks();

    hoisted.mockEncryptWalletIdForStorage.mockImplementation(async (walletId: string) => `enc-v1:${walletId}`);
    hoisted.mockDecryptWalletIdFromStorage.mockImplementation(async (walletId: string) => walletId.replace(/^enc-v1:/, ''));
    silenceConsoleError();
  });

  afterAll(() => {
    process.env.MODE = originalMode;
  });

  it('migrates plaintext records with round-trip verification', async () => {
    hoisted.mockDbData.bitcoincash = [{ name: 'main', wallet: 'seed:mainnet:one two three' }];
    hoisted.mockDbData.bchtest = [{ name: 'test', wallet: 'hd:testnet:one two three' }];

    const stats = await migrateLegacyPlaintextWalletStorage();

    expect(stats).toEqual({ scanned: 2, migrated: 2, failed: 0, failedWallets: [] });
    expect(hoisted.mockDbData.bitcoincash[0]?.wallet).toBe('enc-v1:seed:mainnet:one two three');
    expect(hoisted.mockDbData.bchtest[0]?.wallet).toBe('enc-v1:hd:testnet:one two three');
    expect(hoisted.mockEncryptWalletIdForStorage).toHaveBeenCalledTimes(2);
    expect(hoisted.mockDecryptWalletIdFromStorage).toHaveBeenCalledTimes(2);
  });

  it('is idempotent and skips already encrypted records on rerun', async () => {
    hoisted.mockDbData.bitcoincash = [{ name: 'main', wallet: 'seed:mainnet:alpha beta gamma' }];

    const first = await migrateLegacyPlaintextWalletStorage();
    const second = await migrateLegacyPlaintextWalletStorage();

    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    expect(second.failed).toBe(0);
  });

  it('continues migrating when one wallet fails and tracks failed names', async () => {
    hoisted.mockDbData.bitcoincash = [
      { name: 'ok-main', wallet: 'seed:mainnet:good one' },
      { name: 'bad-main', wallet: 'seed:mainnet:bad one' },
    ];
    hoisted.mockDbData.bchtest = [{ name: 'ok-test', wallet: 'hd:testnet:good two' }];

    hoisted.mockEncryptWalletIdForStorage.mockImplementation(async (walletId: string) => {
      if (walletId.includes('bad one')) throw new Error('encryption failure');
      return `enc-v1:${walletId}`;
    });

    const stats = await migrateLegacyPlaintextWalletStorage();

    expect(stats.scanned).toBe(3);
    expect(stats.migrated).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.failedWallets).toEqual(['bitcoincash:bad-main']);
    expect(console.error).toHaveBeenCalled();
    expect(hoisted.mockDbData.bitcoincash[0]?.wallet).toMatch(/^enc-v1:/);
    expect(hoisted.mockDbData.bitcoincash[1]?.wallet).toBe('seed:mainnet:bad one');
    expect(hoisted.mockDbData.bchtest[0]?.wallet).toMatch(/^enc-v1:/);
  });

  it('handles mixed encrypted/plaintext state correctly', async () => {
    hoisted.mockDbData.bitcoincash = [
      { name: 'already-encrypted', wallet: 'enc-v1:seed:mainnet:x' },
      { name: 'needs-migration', wallet: 'seed:mainnet:y' },
    ];

    const stats = await migrateLegacyPlaintextWalletStorage();

    expect(stats.scanned).toBe(2);
    expect(stats.migrated).toBe(1);
    expect(stats.failed).toBe(0);
    expect(hoisted.mockDbData.bitcoincash[0]?.wallet).toBe('enc-v1:seed:mainnet:x');
    expect(hoisted.mockDbData.bitcoincash[1]?.wallet).toBe('enc-v1:seed:mainnet:y');
  });

  it('does not overwrite plaintext when round-trip verification mismatches', async () => {
    hoisted.mockDbData.bitcoincash = [{ name: 'main', wallet: 'seed:mainnet:source value' }];

    hoisted.mockEncryptWalletIdForStorage.mockResolvedValue('enc-v1:seed:mainnet:source value');
    hoisted.mockDecryptWalletIdFromStorage.mockResolvedValue('seed:mainnet:different value');

    const stats = await migrateLegacyPlaintextWalletStorage();

    expect(stats.migrated).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.failedWallets).toEqual(['bitcoincash:main']);
    expect(hoisted.mockDbData.bitcoincash[0]?.wallet).toBe('seed:mainnet:source value');
  });
});
