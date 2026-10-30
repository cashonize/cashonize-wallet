/**
 * Mock setup for store tests.
 * Import this file FIRST (before importing the store).
 *
 * Note: vi.mock() calls are hoisted, so mock functions must be defined at
 * module level to be available in both mock factories and test assertions.
 */
import type * as BchWalletLib from '@cashonize/bch-wallet-lib'
import type * as ZodValidation from 'src/utils/zodValidation'
import type * as ErrorHandling from 'src/utils/errorHandling'
import type * as Utils from 'src/utils/utils'
import type * as CacheUtils from 'src/utils/cacheUtils'
import { vi } from 'vitest'

// Mock wallet instances
export const mockMainnetWallet = {
  name: 'testWallet',
  network: 'mainnet',
  cashaddr: 'bitcoincash:qtest',
  tokenaddr: 'bitcoincash:ztest',
  publicKeyHash: new Uint8Array([1, 2, 3]),
  // deliberately not a decodable address: the portfolio lookups root at the wallet's public key
  // hashes, and an address that decodes would make every wallet initialization in the tests fetch
  getDepositAddress: () => 'bitcoincash:qtest',
  getTokenDepositAddress: () => 'bitcoincash:ztest',
  setProvider: vi.fn().mockResolvedValue(undefined),
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
  setProvider: vi.fn().mockResolvedValue(undefined),
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

// The provider the store makes for the selected server; the wallets' setProvider takes it
export const mockProvider = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(true),
  getRawTransactionObject: vi.fn().mockResolvedValue({ vin: [], vout: [] }),
}

// Mock wallet classes (must be real classes so instanceof checks work)
class MockWallet { static named = mockWalletNamed; static fromId = mockWalletFromId }
class MockTestNetWallet { static named = mockTestNetWalletNamed; static fromId = mockTestNetWalletFromId }
class MockHDWallet { static named = mockHDWalletNamed; static fromId = mockHDWalletFromId }
class MockTestNetHDWallet { static named = mockTestNetHDWalletNamed; static fromId = mockTestNetHDWalletFromId }

// Mock bch-wallet-lib. The publication output parser is the real one: a publication is bytes on the
// chain, and the tests that name an identity from one hand the store real bytecode. The error
// classes are the real ones too, as the store tells them apart with instanceof.
vi.mock('@cashonize/bch-wallet-lib', async (importOriginal) => ({
  OpReturnData: (await importOriginal<typeof BchWalletLib>()).OpReturnData,
  networkConfig: (await importOriginal<typeof BchWalletLib>()).networkConfig,
  MAX_OP_RETURN_BYTES: (await importOriginal<typeof BchWalletLib>()).MAX_OP_RETURN_BYTES,
  InsufficientFundsError: (await importOriginal<typeof BchWalletLib>()).InsufficientFundsError,
  UtxoNotAvailableError: (await importOriginal<typeof BchWalletLib>()).UtxoNotAvailableError,
  BroadcastRejectedError: (await importOriginal<typeof BchWalletLib>()).BroadcastRejectedError,
  ElectrumTimeoutError: (await importOriginal<typeof BchWalletLib>()).ElectrumTimeoutError,
  BroadcastTimeoutError: (await importOriginal<typeof BchWalletLib>()).BroadcastTimeoutError,
  toHex: (await importOriginal<typeof BchWalletLib>()).toHex,
  DEPOSIT_BRANCH: (await importOriginal<typeof BchWalletLib>()).DEPOSIT_BRANCH,
  CHANGE_BRANCH: (await importOriginal<typeof BchWalletLib>()).CHANGE_BRANCH,
  GAP_SIZE: (await importOriginal<typeof BchWalletLib>()).GAP_SIZE,
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
  createProvider: vi.fn().mockResolvedValue(mockProvider),
  createFailoverProvider: vi.fn().mockResolvedValue(mockProvider),
  setGlobalProvider: vi.fn(),
  DefaultProvider: {
    servers: { mainnet: [], testnet: [], regtest: [] },
  },
  deleteNamedWallet: mockDeleteNamedWallet,
  getNamedWalletId: mockGetNamedWalletId,
}))

// Mock IndexedDB provider
vi.mock('@cashonize/bch-wallet-lib/indexeddb', () => ({
  IndexedDBProvider: vi.fn(),
}))

// Mock the wallet database access
export const mockGetAllWalletsWithNetworkInfo = vi.fn()
export const mockDeleteNamedWallet = vi.fn()
export const mockPruneDeletedWalletCaches = vi.fn().mockResolvedValue(undefined)

// Wallets exist in IndexedDB by default, override per-test to exercise the missing-wallet guard
export const mockNamedWalletExistsInDb = vi.fn().mockResolvedValue(true)
function defaultGetNamedWalletId(
  _name: string,
  dbName: 'bitcoincash' | 'bchtest'
): Promise<string | undefined> {
  const walletId = dbName === 'bitcoincash'
    ? 'seed:mainnet:test mnemonic:m/44\'/145\'/0\'/0/0'
    : 'seed:testnet:test mnemonic:m/44\'/145\'/0\'/0/0'
  return Promise.resolve(walletId)
}
export const mockGetNamedWalletId = vi.fn(defaultGetNamedWalletId)

vi.mock('src/utils/wallet/dbUtils', () => ({
  getAllWalletsWithNetworkInfo: mockGetAllWalletsWithNetworkInfo,
  pruneDeletedWalletCaches: mockPruneDeletedWalletCaches,
  namedWalletExistsInDb: mockNamedWalletExistsInDb,
}))

// Mock settingsStore
export const mockClearWalletSettings = vi.fn()

vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    currency: 'usd',
    bchUnit: 'bch',
    explorerMainnet: 'https://blockchair.com',
    explorerChipnet: 'https://chipnet.chaingraph.cash',
    electrumServerMainnet: 'electrum.imaginary.cash',
    electrumServerChipnet: 'chipnet.bch.ninja',
    electrumModeMainnet: 'single',
    electrumModeChipnet: 'single',
    tokenMetadataIndexerMainnet: 'https://bcmr.paytaca.com/api',
    tokenMetadataIndexerChipnet: 'https://bcmr-chipnet.paytaca.com/api',
    chaingraphMainnet: 'https://chaingraph.example.com/v1/graphql',
    chaingraphChipnet: '',
    ipfsGateway: 'https://ipfs.io/ipfs/',
    followTokenIdentities: true,
    featuredTokens: [],
    getWalletType: vi.fn().mockReturnValue('single'),
    getWalletMetadata: vi.fn().mockReturnValue({ walletType: 'single' }),
    setWalletType: vi.fn(),
    clearWalletSettings: mockClearWalletSettings,
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

// Mock utils that use quasar; the error class is the real one, which the spend errors are made of
vi.mock('src/utils/errorHandling', async (importOriginal) => ({
  ActionableError: (await importOriginal<typeof ErrorHandling>()).ActionableError,
  displayAndLogError: vi.fn(),
}))

// Mock cacheUtils
vi.mock('src/utils/cacheUtils', async (importOriginal) => ({
  cachedFetch: vi.fn(),
  isFreshLookup: (await importOriginal<typeof CacheUtils>()).isFreshLookup,
}))

// Mock zodValidation
// the registry schema is the real one: naming an identity from a registry parses what a host served
vi.mock('src/utils/zodValidation', async (importOriginal) => ({
  BcmrIndexerResponseSchema: { safeParse: vi.fn() },
  MetadataRegistrySchema: (await importOriginal<typeof ZodValidation>()).MetadataRegistrySchema,
}))

// Mock storeUtils
vi.mock('src/stores/storeUtils', () => ({
  fetchTokenMetadata: vi.fn().mockResolvedValue({}),
  tokenListFromUtxos: vi.fn().mockReturnValue([]),
}))

// Mock utils
// the list comparison is the real one: whether the store reassigns tokenList depends on it
vi.mock('src/utils/utils', async (importOriginal) => ({
  sameTokenList: (await importOriginal<typeof Utils>()).sameTokenList,
  formatBchAmount: vi.fn((satoshis: number) => (satoshis / 100_000_000).toString()),
  formatBch: vi.fn((satoshis: bigint, network: string) => `${Number(satoshis) / 100_000_000} ${network === 'mainnet' ? 'BCH' : 'tBCH'}`),
  getBalanceFromUtxos: vi.fn().mockReturnValue(0),
  getTokenUtxos: vi.fn().mockReturnValue([]),
  walletTypeFromWalletId: vi.fn((walletId: string) => walletId.startsWith('hd:') ? 'hd' : 'single'),
  loadWalletFromId: vi.fn((walletId: string, network: 'mainnet' | 'chipnet') => {
    const isHD = walletId.startsWith('hd:')
    if (network === 'mainnet') return isHD ? mockHDWalletFromId(walletId) : mockWalletFromId(walletId)
    return isHD ? mockTestNetHDWalletFromId(walletId) : mockTestNetWalletFromId(walletId)
  }),
  convertElectrumTokenData: vi.fn(),
  STALE_TIP_SECONDS: (await importOriginal<typeof Utils>()).STALE_TIP_SECONDS,
  electrumWssUrl: vi.fn((server: string) => server.includes(":") ? `wss://${server}` : `wss://${server}:50004`),
}))
