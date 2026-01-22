/**
 * Browser test setup file.
 * Sets up Pinia, mocks Quasar and external dependencies.
 */
import { vi } from 'vitest'
import { config } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Create and activate a fresh Pinia instance for each test
const pinia = createPinia()
setActivePinia(pinia)
config.global.plugins = [pinia]

// Mock localStorage
export const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMock.store[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageMock.store[key] }),
  clear: vi.fn(() => { localStorageMock.store = {} }),
  get length() { return Object.keys(localStorageMock.store).length },
  key: vi.fn((index: number) => Object.keys(localStorageMock.store)[index] ?? null),
}
vi.stubGlobal('localStorage', localStorageMock)

// Mock matchMedia for dark mode detection
vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})))

// Mock quasar's useQuasar composable
export const mockNotify = vi.fn()
export const mockDialog = vi.fn()

vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: mockNotify,
    dialog: mockDialog,
  }),
  Notify: {
    create: mockNotify,
  },
}))

// Mock mainnet-js
export const mockWalletNamed = vi.fn()
export const mockWalletReplaceNamed = vi.fn()
export const mockTestNetWalletNamed = vi.fn()
export const mockTestNetWalletReplaceNamed = vi.fn()

class MockConnection {
  networkProvider = {}
  constructor() {}
}

vi.mock('mainnet-js', () => ({
  Wallet: {
    named: mockWalletNamed,
    replaceNamed: mockWalletReplaceNamed,
  },
  TestNetWallet: {
    named: mockTestNetWalletNamed,
    replaceNamed: mockTestNetWalletReplaceNamed,
  },
  Config: {
    EnforceCashTokenReceiptAddresses: true,
    UseIndexedDBCache: true,
    DefaultParentDerivationPath: '',
    DefaultCurrency: 'usd',
  },
  BaseWallet: {
    StorageProvider: undefined,
  },
  NetworkType: {
    Mainnet: 'mainnet',
    Testnet: 'testnet',
  },
  DefaultProvider: {
    servers: {
      chipnet: [],
    },
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
export const mockNamedWalletExistsInDb = vi.fn().mockResolvedValue(false)
export const mockGetAllWalletsWithNetworkInfo = vi.fn().mockResolvedValue([])
export const mockDeleteWalletFromDb = vi.fn()

vi.mock('src/utils/dbUtils', () => ({
  namedWalletExistsInDb: mockNamedWalletExistsInDb,
  getAllWalletsWithNetworkInfo: mockGetAllWalletsWithNetworkInfo,
  deleteWalletFromDb: mockDeleteWalletFromDb,
}))

// Mock walletUtils - the functions used in onboarding
// Default to success: false so tests must explicitly set up expected behavior
export const mockCreateNewWallet = vi.fn().mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })
export const mockImportWallet = vi.fn().mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })

vi.mock('src/utils/walletUtils', () => ({
  createNewWallet: mockCreateNewWallet,
  importWallet: mockImportWallet,
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
    start: vi.fn().mockResolvedValue(undefined),
    cashConnectWallet: {
      disconnectAllSessions: vi.fn().mockResolvedValue(undefined),
    },
  })),
}))

// Mock utils that use quasar
vi.mock('src/utils/errorHandling', () => ({
  caughtErrorToString: vi.fn().mockReturnValue('mock error'),
  displayAndLogError: vi.fn(),
  isQuotaExceededError: vi.fn().mockReturnValue(false),
  tryCatch: vi.fn().mockImplementation(async (fn) => {
    try {
      return [await fn(), null]
    } catch (e) {
      return [null, e]
    }
  }),
}))

// Mock cacheUtils
vi.mock('src/utils/cacheUtils', () => ({
  cachedFetch: vi.fn(),
}))

// Mock storeUtils
vi.mock('src/stores/storeUtils', () => ({
  fetchTokenMetadata: vi.fn().mockResolvedValue({}),
  tokenListFromUtxos: vi.fn().mockReturnValue([]),
  updateTokenListWithAuthUtxos: vi.fn().mockReturnValue([]),
}))

// Mock utils
vi.mock('src/utils/utils', () => ({
  copyToClipboard: vi.fn(),
  runAsyncVoid: vi.fn((fn) => fn()),
  formatTime: vi.fn().mockReturnValue(''),
  formatRelativeTime: vi.fn().mockReturnValue(''),
  formatTimestamp: vi.fn().mockReturnValue(''),
  convertToCurrency: vi.fn().mockReturnValue(0),
  formatFiatAmount: vi.fn().mockReturnValue('$0.00'),
  satsToBch: vi.fn().mockReturnValue('0'),
  getTokenUtxos: vi.fn().mockReturnValue([]),
  getAllNftTokenBalances: vi.fn().mockReturnValue([]),
  getFungibleTokenBalances: vi.fn().mockReturnValue([]),
  getBalanceFromUtxos: vi.fn().mockReturnValue(0),
  parseExtendedJson: vi.fn(),
  convertElectrumTokenData: vi.fn(),
  waitForInitialized: vi.fn().mockResolvedValue(undefined),
}))

// Mock zodValidation
vi.mock('src/utils/zodValidation', () => ({
  BcmrIndexerResponseSchema: { safeParse: vi.fn() },
  BitpayRatesSchema: { safeParse: vi.fn() },
  CoinGeckoRatesSchema: { safeParse: vi.fn() },
  CoinbaseRatesSchema: { safeParse: vi.fn() },
}))

// Mock @vueuse/core
vi.mock('@vueuse/core', () => ({
  useWindowSize: () => ({
    width: { value: 1024 },
    height: { value: 768 },
  }),
}))

// Mock @vueform/toggle - just render as a checkbox
vi.mock('@vueform/toggle', () => ({
  default: {
    name: 'Toggle',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\')" />',
  },
}))

// Reset mocks before each test
beforeEach(() => {
  // Clear call history but preserve mock implementations
  vi.clearAllMocks()
  localStorageMock.store = {}
  // Reset the mock implementations to default (failure) state
  mockCreateNewWallet.mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })
  mockImportWallet.mockResolvedValue({ success: false, message: 'Mock not configured', isUserError: true })
  setActivePinia(createPinia())
})
