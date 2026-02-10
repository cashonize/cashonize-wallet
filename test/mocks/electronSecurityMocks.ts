import { vi } from 'vitest';

type SecureStorageBridge = {
  isAvailable: ReturnType<typeof vi.fn>;
  encrypt: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
};

export function setProcessMode(mode: string) {
  process.env.MODE = mode;
}

export function createSecureStorageBridge(overrides?: Partial<SecureStorageBridge>): SecureStorageBridge {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    encrypt: vi.fn(async (plaintext: string) => `cipher:${plaintext}`),
    decrypt: vi.fn(async (ciphertext: string) => ciphertext.replace('cipher:', '')),
    ...overrides,
  };
}

export function stubSecureStorageBridge(bridge: SecureStorageBridge) {
  vi.stubGlobal('window', { cashonizeSecureStorage: bridge });
}

export function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}
