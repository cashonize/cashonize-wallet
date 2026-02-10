import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSecureStorageBridge,
  setProcessMode,
  stubSecureStorageBridge,
} from '../mocks/electronSecurityMocks';
import {
  decryptWalletIdFromStorage,
  encryptWalletIdForStorage,
  isEncryptedWalletId,
} from '../../src/security/walletIdEncryption';

describe('walletIdEncryption', () => {
  const originalMode = process.env.MODE;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MODE = originalMode;
  });

  it('round-trips encrypt/decrypt in electron mode', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge();
    stubSecureStorageBridge(bridge);

    const walletId = 'seed:mainnet:test words here';
    const encrypted = await encryptWalletIdForStorage(walletId);
    const decrypted = await decryptWalletIdFromStorage(encrypted);

    expect(isEncryptedWalletId(encrypted)).toBe(true);
    expect(decrypted).toBe(walletId);
    expect(bridge.encrypt).toHaveBeenCalledTimes(1);
    expect(bridge.decrypt).toHaveBeenCalledTimes(1);
  });

  it('does not double-encrypt already encrypted wallet id', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge();
    stubSecureStorageBridge(bridge);

    const alreadyEncrypted = 'enc-v1:abc123';
    const result = await encryptWalletIdForStorage(alreadyEncrypted);

    expect(result).toBe(alreadyEncrypted);
    expect(bridge.encrypt).not.toHaveBeenCalled();
  });

  it('passes through in non-electron mode without using secure bridge', async () => {
    setProcessMode('spa');
    const bridge = createSecureStorageBridge({
      isAvailable: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    });
    stubSecureStorageBridge(bridge);

    const walletId = 'hd:mainnet:test words';
    const encrypted = await encryptWalletIdForStorage(walletId);
    const decrypted = await decryptWalletIdFromStorage(walletId);

    expect(encrypted).toBe(walletId);
    expect(decrypted).toBe(walletId);
    expect(bridge.encrypt).not.toHaveBeenCalled();
    expect(bridge.decrypt).not.toHaveBeenCalled();
  });

  it('throws when secure storage is unavailable in electron mode', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge({
      isAvailable: vi.fn().mockResolvedValue(false),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    });
    stubSecureStorageBridge(bridge);

    await expect(encryptWalletIdForStorage('seed:mainnet:test words')).rejects.toThrow(
      'OS secure storage is unavailable; refusing to persist plaintext wallet material',
    );
  });

  it('rejects empty ciphertext after encrypted prefix', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge({
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    });
    stubSecureStorageBridge(bridge);

    await expect(decryptWalletIdFromStorage('enc-v1:')).rejects.toThrow(
      'Encrypted wallet record is missing ciphertext',
    );
  });

  it('rejects corrupted decrypted wallet ids', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge({
      decrypt: vi.fn().mockResolvedValue('garbage-output'),
    });
    stubSecureStorageBridge(bridge);

    await expect(decryptWalletIdFromStorage('enc-v1:deadbeef')).rejects.toThrow(
      'Decrypted wallet record is invalid',
    );
  });

  it('rejects colon-separated but invalid wallet-id format', async () => {
    setProcessMode('electron');
    const bridge = createSecureStorageBridge({
      decrypt: vi.fn().mockResolvedValue('foo:bar:baz'),
    });
    stubSecureStorageBridge(bridge);

    await expect(decryptWalletIdFromStorage('enc-v1:deadbeef')).rejects.toThrow(
      'Decrypted wallet record is invalid',
    );
  });
});
