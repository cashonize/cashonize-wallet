const ENCRYPTED_WALLET_ID_PREFIX = 'enc-v1:';

function isElectronMode(): boolean {
  return process.env.MODE === 'electron';
}

function ensureSecureStorageBridge() {
  const bridge = window.cashonizeSecureStorage;
  if (!bridge) {
    throw new Error('Electron secure storage bridge is unavailable in renderer process');
  }
  return bridge;
}

function isLikelyWalletId(walletId: string): boolean {
  return /^[a-z]+:(mainnet|testnet):/.test(walletId);
}

export function isEncryptedWalletId(walletId: string): boolean {
  return walletId.startsWith(ENCRYPTED_WALLET_ID_PREFIX);
}

export async function encryptWalletIdForStorage(walletId: string): Promise<string> {
  if (isEncryptedWalletId(walletId)) return walletId;
  if (!isElectronMode()) {
    // TODO: implement WebCrypto/PIN-based encryption for non-Electron modes.
    return walletId;
  }

  const bridge = ensureSecureStorageBridge();
  const available = await bridge.isAvailable();
  if (!available) {
    throw new Error('OS secure storage is unavailable; refusing to persist plaintext wallet material');
  }

  const encryptedBase64 = await bridge.encrypt(walletId);
  return `${ENCRYPTED_WALLET_ID_PREFIX}${encryptedBase64}`;
}

export async function decryptWalletIdFromStorage(walletId: string): Promise<string> {
  if (!isEncryptedWalletId(walletId)) return walletId;
  if (!isElectronMode()) {
    throw new Error('Encountered encrypted wallet data outside Electron mode');
  }

  const bridge = ensureSecureStorageBridge();
  const available = await bridge.isAvailable();
  if (!available) {
    throw new Error('OS secure storage is unavailable; cannot decrypt wallet material');
  }

  const encryptedBase64 = walletId.slice(ENCRYPTED_WALLET_ID_PREFIX.length);
  if (!encryptedBase64) {
    throw new Error('Encrypted wallet record is missing ciphertext');
  }

  const decrypted = await bridge.decrypt(encryptedBase64);
  if (!decrypted || !isLikelyWalletId(decrypted)) {
    throw new Error('Decrypted wallet record is invalid');
  }
  return decrypted;
}
