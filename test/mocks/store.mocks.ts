/**
 * Mock setup for store tests.
 * Import this file FIRST (before importing the store).
 *
 * Note: vi.mock() calls are hoisted, so mock functions must be defined at
 * module level to be available in both mock factories and test assertions.
 */
import { vi } from 'vitest'

// Mock wallet instances
export const mockMainnetWallet = {
  name: 'testWallet',
  network: 'mainnet',
  cashaddr: 'bitcoincash:qtest',
  tokenaddr: 'bitcoincash:ztest',
  publicKeyHash: new Uint8Array([1, 2, 3]),
}

export const mockChipnetWallet = {
  name: 'testWallet',
  network: 'chipnet',
  cashaddr: 'bchtest:qtest',
  tokenaddr: 'bchtest:ztest',
  publicKeyHash: new Uint8Array([1, 2, 3]),
}

// Mock functions for wallet classes
export const mockWalletNamed = vi.fn()
export const mockTestNetWalletNamed = vi.fn()

// Mock localStorage
export const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMock.store[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageMock.store[key] }),
  clear: vi.fn(() => { localStorageMock.store = {} }),
}
vi.stubGlobal('localStorage', localStorageMock)

// Mock Connection class
class MockConnection {
  networkProvider = { /* mock provider */ }
  constructor() {
    // Constructor does nothing, just provides networkProvider
  }
}

// Mock mainnet-js
vi.mock('mainnet-js', () => ({
  Wallet: {
    named: mockWalletNamed,
  },
  TestNetWallet: {
    named: mockTestNetWalletNamed,
  },
  Config: {
    EnforceCashTokenReceiptAddresses: true,
    UseIndexedDBCache: true,
  },
  BaseWallet: {
    StorageProvider: undefined,
  },
  NetworkType: {
    Mainnet: 'mainnet',
    Testnet: 'testnet',
  },
  convert: vi.fn().mockResolvedValue(0),
  balanceResponseFromSatoshi: vi.fn().mockReturnValue({ sat: 0, bch: 0 }),
  binToHex: vi.fn((arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')),
  Connection: MockConnection,
}))

// Mock IndexedDB provider
vi.mock('@mainnet-cash/indexeddb-storage', () => ({
  IndexedDBProvider: vi.fn(),
}))

// Mock dbUtils
export const mockGetAllWalletsWithNetworkInfo = vi.fn()
export const mockDeleteWalletFromDb = vi.fn()

vi.mock('src/utils/dbUtils', () => ({
  getAllWalletsWithNetworkInfo: mockGetAllWalletsWithNetworkInfo,
  deleteWalletFromDb: mockDeleteWalletFromDb,
}))

// Mock settingsStore
vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    currency: 'usd',
    bchUnit: 'bch',
    explorerMainnet: 'https://blockchair.com',
    explorerChipnet: 'https://chipnet.chaingraph.cash',
    ipfsGateway: 'https://ipfs.io/ipfs/',
  })),
}))

// Mock walletconnectStore
vi.mock('src/stores/walletconnectStore', () => ({
  useWalletconnectStore: vi.fn(() => ({
    initweb3wallet: vi.fn().mockResolvedValue(undefined),
    web3wallet: null,
  })),
}))

// Mock cashconnectStore
vi.mock('src/stores/cashconnectStore', () => ({
  useCashconnectStore: vi.fn(() => ({
    initCashconnect: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock quasar
vi.mock('quasar', () => ({
  Notify: {
    create: vi.fn(),
  },
}))

// Mock utils that use quasar
vi.mock('src/utils/errorHandling', () => ({
  displayAndLogError: vi.fn(),
}))

// Mock cacheUtils
vi.mock('src/utils/cacheUtils', () => ({
  cachedFetch: vi.fn(),
}))

// Mock zodValidation
vi.mock('src/utils/zodValidation', () => ({
  BcmrIndexerResponseSchema: { safeParse: vi.fn() },
}))

// Mock storeUtils
vi.mock('src/stores/storeUtils', () => ({
  importBcmrRegistries: vi.fn().mockResolvedValue({}),
  tokenListFromUtxos: vi.fn().mockReturnValue([]),
  updateTokenListWithAuthUtxos: vi.fn().mockReturnValue([]),
}))

// Mock utils
vi.mock('src/utils/utils', () => ({
  getBalanceFromUtxos: vi.fn().mockReturnValue(0),
  getTokenUtxos: vi.fn().mockReturnValue([]),
  runAsyncVoid: vi.fn((fn) => fn()),
  convertElectrumTokenData: vi.fn(),
}))
