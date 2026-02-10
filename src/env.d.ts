declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

interface Window {
  cashonizeSecureStorage?: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plaintext: string) => Promise<string>;
    decrypt: (encryptedBase64: string) => Promise<string>;
  };
  cashonizeElectronSecurity?: {
    onLockRequested: (callback: (reason: string) => void) => () => void;
  };
}
