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
  getDepositAddress: () => 'bitcoincash:qtest',
  getTokenDepositAddress: () => 'bitcoincash:ztest',
  stop: vi.fn().mockResolvedValue(undefined),
}

export const mockChipnetWallet = {
  name: 'testWallet',
  network: 'chipnet',
  cashaddr: 'bchtest:qtest',
  tokenaddr: 'bchtest:ztest',
  publicKeyHash: new Uint8Array([1, 2, 3]),
  getDepositAddress: () => 'bchtest:qtest',
  getTokenDepositAddress: () => 'bchtest:ztest',
  stop: vi.fn().mockResolvedValue(undefined),
}

// Mock functions for wallet classes
export const mockWalletNamed = vi.fn()
export const mockTestNetWalletNamed = vi.fn()
export const mockHDWalletNamed = vi.fn()
export const mockTestNetHDWalletNamed = vi.fn()
export const mockWalletFromId = vi.fn().mockResolvedValue(mockMainnetWallet)
export const mockTestNetWalletFromId = vi.fn().mockResolvedValue(mockChipnetWallet)
export const mockHDWalletFromId = vi.fn().mockResolvedValue(mockMainnetWallet)
export const mockTestNetHDWalletFromId = vi.fn().mockResolvedValue(mockChipnetWallet)

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
  networkProvider = {
    connect: vi.fn().mockResolvedValue(undefined),
    getRawTransactionObject: vi.fn().mockResolvedValue({ vin: [], vout: [] }),
  }
  constructor() {
    // Constructor does nothing, just provides networkProvider
  }
}

// Mock wallet classes (must be real classes so instanceof checks work)
class MockWallet { static named = mockWalletNamed; static fromId = mockWalletFromId }
class MockTestNetWallet { static named = mockTestNetWalletNamed; static fromId = mockTestNetWalletFromId }
class MockHDWallet { static named = mockHDWalletNamed; static fromId = mockHDWalletFromId }
class MockTestNetHDWallet { static named = mockTestNetHDWalletNamed; static fromId = mockTestNetHDWalletFromId }

// Mock mainnet-js
vi.mock('mainnet-js', () => ({
  Wallet: MockWallet,
  TestNetWallet: MockTestNetWallet,
  HDWallet: MockHDWallet,
  TestNetHDWallet: MockTestNetHDWallet,
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
  DefaultProvider: {
    servers: { mainnet: [], testnet: [], regtest: [] },
  },
}))

// Mock IndexedDB provider
vi.mock('@mainnet-cash/indexeddb-storage', () => ({
  IndexedDBProvider: vi.fn(),
}))

// Mock dbUtils
export const mockGetAllWalletsWithNetworkInfo = vi.fn()
export const mockDeleteWalletFromDb = vi.fn()

// Wallets exist in IndexedDB by default, override per-test to exercise the missing-wallet guard
export const mockNamedWalletExistsInDb = vi.fn().mockResolvedValue(true)
function defaultGetNamedWalletIdFromDb(
  _name: string,
  dbName: 'bitcoincash' | 'bchtest'
): Promise<string | undefined> {
  const walletId = dbName === 'bitcoincash'
    ? 'seed:mainnet:test mnemonic:m/44\'/145\'/0\'/0/0'
    : 'seed:testnet:test mnemonic:m/44\'/145\'/0\'/0/0'
  return Promise.resolve(walletId)
}
export const mockGetNamedWalletIdFromDb = vi.fn(defaultGetNamedWalletIdFromDb)

vi.mock('src/utils/dbUtils', () => ({
  getAllWalletsWithNetworkInfo: mockGetAllWalletsWithNetworkInfo,
  deleteWalletFromDb: mockDeleteWalletFromDb,
  namedWalletExistsInDb: mockNamedWalletExistsInDb,
  getNamedWalletIdFromDb: mockGetNamedWalletIdFromDb,
}))

// Mock settingsStore
vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    currency: 'usd',
    bchUnit: 'bch',
    explorerMainnet: 'https://blockchair.com',
    explorerChipnet: 'https://chipnet.chaingraph.cash',
    ipfsGateway: 'https://ipfs.io/ipfs/',
    featuredTokens: [],
    getWalletType: vi.fn().mockReturnValue('single'),
    getWalletMetadata: vi.fn().mockReturnValue({ walletType: 'single' }),
    setWalletType: vi.fn(),
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
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock wizardconnectStore
vi.mock('src/stores/wizardconnectStore', () => ({
  useWizardconnectStore: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
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
  fetchTokenMetadata: vi.fn().mockResolvedValue({}),
  tokenListFromUtxos: vi.fn().mockReturnValue([]),
  updateTokenListWithAuthUtxos: vi.fn().mockReturnValue([]),
}))

// Mock utils
vi.mock('src/utils/utils', () => ({
  getBalanceFromUtxos: vi.fn().mockReturnValue(0),
  getTokenUtxos: vi.fn().mockReturnValue([]),
  walletTypeFromWalletId: vi.fn((walletId: string) => walletId.startsWith('hd:') ? 'hd' : 'single'),
  loadWalletFromId: vi.fn((walletId: string, network: 'mainnet' | 'chipnet') => {
    const isHD = walletId.startsWith('hd:')
    if (network === 'mainnet') return isHD ? mockHDWalletFromId(walletId) : mockWalletFromId(walletId)
    return isHD ? mockTestNetHDWalletFromId(walletId) : mockTestNetWalletFromId(walletId)
  }),
  runAsyncVoid: vi.fn((fn) => fn()),
  convertElectrumTokenData: vi.fn(),
}))
