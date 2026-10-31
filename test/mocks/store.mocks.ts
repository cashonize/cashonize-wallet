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
  network: 'testnet', // the library's name for chipnet
  cashaddr: 'bchtest:qtest',
  publicKeyHash: new Uint8Array([1, 2, 3]),
  getDepositAddress: () => 'bchtest:qtest',
  getTokenDepositAddress: () => 'bchtest:ztest',
  setProvider: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}

// Mock functions for wallet classes
export const mockWalletNamed = vi.fn()
export const mockHDWalletNamed = vi.fn()
// the wallet of the network a stored id is loaded with, as the library's fromId gives
function walletOfNetwork(_walletId: string, options?: { network?: string }) {
  if (options?.network === 'testnet') return Promise.resolve(mockChipnetWallet)
  if (options?.network === 'testnet4') return Promise.resolve({ ...mockChipnetWallet, network: 'testnet4' })
  return Promise.resolve(mockMainnetWallet)
}
export const mockWalletFromId = vi.fn(walletOfNetwork)
export const mockHDWalletFromId = vi.fn(walletOfNetwork)

// Mock localStorage
export const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMock.store[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageMock.store[key] }),
  clear: vi.fn(() => { localStorageMock.store = {} }),
}
vi.stubGlobal('localStorage', localStorageMock)

type UtxoChange = { utxos: BchWalletLib.Utxo[], added: BchWalletLib.Utxo[], removed: BchWalletLib.Utxo[] }
// The library's watchUtxos for a fake wallet: the first callback with the coins of the wallet's own
// getUtxos, as the library reads them, and each later change handed in by the test, resolving once
// the store's handler has finished with it
export function utxoWatch() {
  let handler: ((change: UtxoChange) => unknown) | undefined
  let onError: ((error: unknown) => unknown) | undefined
  const watchUtxos = vi.fn(async function (
    this: { getUtxos(): Promise<BchWalletLib.Utxo[]> },
    callback: (change: UtxoChange) => unknown,
    options: { onError?: (error: unknown) => unknown } = {},
  ) {
    const utxos = await this.getUtxos()
    handler = callback
    onError = options.onError
    void callback({ utxos, added: [], removed: [] })
    return async () => {}
  })
  const change = async (change: UtxoChange) => { await handler!(change) }
  // a read after the first that failed, as the library hands it on
  const fail = (error: unknown) => { onError?.(error) }
  return { watchUtxos, change, fail }
}

// The provider the store makes for the selected server; the wallets' setProvider takes it
export const mockProvider = {
  disconnect: vi.fn().mockResolvedValue(true),
}

// Mock wallet classes (must be real classes so instanceof checks work)
class MockWallet { static named = mockWalletNamed; static fromId = mockWalletFromId }
class MockHDWallet { static named = mockHDWalletNamed; static fromId = mockHDWalletFromId }

// Mock bch-wallet-lib. The publication output parser is the real one: a publication is bytes on the
// chain, and the tests that name an identity from one hand the store real bytecode. The error
// classes are the real ones too, as the store tells them apart with instanceof.
vi.mock('@cashonize/bch-wallet-lib', async (importOriginal) => ({
  OpReturnData: (await importOriginal<typeof BchWalletLib>()).OpReturnData,
  networkConfig: (await importOriginal<typeof BchWalletLib>()).networkConfig,
  knownNetworks: (await importOriginal<typeof BchWalletLib>()).knownNetworks,
  registerNetwork: (await importOriginal<typeof BchWalletLib>()).registerNetwork,
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
  HDWallet: MockHDWallet,
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
  dbName: 'bitcoincash' | 'bchtest' | 'bchtest4'
): Promise<string | undefined> {
  const network = { bitcoincash: 'mainnet', bchtest: 'testnet', bchtest4: 'testnet4' }[dbName]
  return Promise.resolve(`seed:${network}:test mnemonic:m/44'/145'/0'/0/0`)
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
    explorer: { mainnet: 'https://blockchair.com', chipnet: 'https://chipnet.chaingraph.cash', testnet4: 'https://tbch4.loping.net/tx' },
    electrumServer: { mainnet: 'electrum.imaginary.cash', chipnet: 'chipnet.bch.ninja', testnet4: 'testnet4.imaginary.cash' },
    electrumMode: { mainnet: 'single', chipnet: 'single', testnet4: 'single' },
    tokenMetadataIndexer: { mainnet: 'https://bcmr.paytaca.com/api', chipnet: 'https://bcmr-chipnet.paytaca.com/api', testnet4: '' },
    chaingraph: { mainnet: 'https://chaingraph.example.com/v1/graphql', chipnet: '', testnet4: '' },
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
export const mockCashconnectStart = vi.fn().mockResolvedValue(undefined)
vi.mock('src/stores/cashconnectStore', () => ({
  useCashconnectStore: vi.fn(() => ({
    start: mockCashconnectStart,
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock wizardconnectStore
export const mockWizardconnectStart = vi.fn().mockResolvedValue(undefined)
vi.mock('src/stores/wizardconnectStore', () => ({
  useWizardconnectStore: vi.fn(() => ({
    start: mockWizardconnectStart,
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
  // the real one, on the mocked wallet classes: which class and network a stored id loads with is
  // what the network tests check
  loadWalletFromId: (await importOriginal<typeof Utils>()).loadWalletFromId,
  newTokenItems: (await importOriginal<typeof Utils>()).newTokenItems,
  STALE_TIP_SECONDS: (await importOriginal<typeof Utils>()).STALE_TIP_SECONDS,
  electrumWssUrl: vi.fn((server: string) => server.includes(":") ? `wss://${server}` : `wss://${server}:50004`),
}))
