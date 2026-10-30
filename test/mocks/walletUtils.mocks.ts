/**
 * Mock setup for walletUtils tests.
 * Import this file FIRST (before importing the module under test).
 *
 * Note: vi.mock() calls are hoisted, so mock functions must be defined at
 * module level to be available in both mock factories and test assertions.
 */
import type * as BchWalletLib from '@cashonize/bch-wallet-lib'
import { vi } from 'vitest'

// Mock functions for wallet classes
export const mockWalletNamed = vi.fn()
export const mockHDWalletNamed = vi.fn()
export const mockTestNetWalletNamed = vi.fn()
export const mockTestNetHDWalletNamed = vi.fn()
// Stores a wallet id under a name without constructing the wallet
export const mockSaveNamedWallet = vi.fn()
// The history the derivation path scan asks the mainnet provider for, per address
export const mockGetHistory = vi.fn()
// The network's provider, which scans read history from; the tests check which network was asked
// The unspent coins the untie check asks the chipnet provider for, per address
export const mockGetUtxos = vi.fn()
export const mockGetNetworkProvider = vi.fn<(network: string) => { getHistory: typeof mockGetHistory, getUtxos: typeof mockGetUtxos }>(() => ({ getHistory: mockGetHistory, getUtxos: mockGetUtxos }))
// The stored id of a named wallet, per database
export const mockGetNamedWalletId = vi.fn()
export const mockDeleteNamedWallet = vi.fn()

// Mock functions for dependencies
export const mockNamedWalletExists = vi.fn()
export const mockSetWallet = vi.fn()
export const mockResetWalletState = vi.fn()
export const mockRefreshAvailableWallets = vi.fn()
export const mockSetWalletCreatedAt = vi.fn()
export const mockSetBackupStatus = vi.fn()
export const mockSetWalletType = vi.fn()
export const mockClearBackupStatus = vi.fn()
export const mockClearWalletSettings = vi.fn()

// Mock localStorage
export const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
vi.stubGlobal('localStorage', localStorageMock)

// Mock store
vi.mock('src/stores/store', () => ({
  useStore: vi.fn(() => ({
    activeWalletName: '',
    setWallet: mockSetWallet,
    resetWalletState: mockResetWalletState,
    refreshAvailableWallets: mockRefreshAvailableWallets,
    initializeWallet: vi.fn().mockResolvedValue(undefined),
  }))
}))

vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    setWalletCreatedAt: mockSetWalletCreatedAt,
    setBackupStatus: mockSetBackupStatus,
    clearBackupStatus: mockClearBackupStatus,
    clearWalletSettings: mockClearWalletSettings,
    setWalletType: mockSetWalletType,
  }))
}))

export const mockGetAllWalletsWithNetworkInfo = vi.fn()
vi.mock('src/utils/wallet/dbUtils', () => ({
  getAllWalletsWithNetworkInfo: mockGetAllWalletsWithNetworkInfo,
}))

// The derivation helpers are the real ones: the scan's addresses are checked against libauth's
vi.mock('@cashonize/bch-wallet-lib', async (importOriginal) => ({
  NetworkType: (await importOriginal<typeof BchWalletLib>()).NetworkType,
  networkConfig: (await importOriginal<typeof BchWalletLib>()).networkConfig,
  getXPubKey: (await importOriginal<typeof BchWalletLib>()).getXPubKey,
  getAddrsByXpubKey: (await importOriginal<typeof BchWalletLib>()).getAddrsByXpubKey,
  getNetworkProvider: mockGetNetworkProvider,
  namedWalletExists: mockNamedWalletExists,
  getNamedWalletId: mockGetNamedWalletId,
  deleteNamedWallet: mockDeleteNamedWallet,
  saveNamedWallet: mockSaveNamedWallet,
  Wallet: {
    named: mockWalletNamed,
  },
  HDWallet: {
    named: mockHDWalletNamed,
  },
  TestNetWallet: {
    named: mockTestNetWalletNamed,
  },
  TestNetHDWallet: {
    named: mockTestNetHDWalletNamed,
  },
  Config: {
    DefaultParentDerivationPath: '',
  }
}))
