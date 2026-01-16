/**
 * Mock setup for walletUtils tests.
 * Import this file FIRST (before importing the module under test).
 *
 * Note: vi.mock() calls are hoisted, so mock functions must be defined at
 * module level to be available in both mock factories and test assertions.
 */
import { vi } from 'vitest'

// Mock functions for wallet classes
export const mockWalletNamed = vi.fn()
export const mockWalletReplaceNamed = vi.fn()
export const mockTestNetWalletReplaceNamed = vi.fn()

// Mock functions for dependencies
export const mockNamedWalletExistsInDb = vi.fn()
export const mockSetWallet = vi.fn()
export const mockRefreshAvailableWallets = vi.fn()
export const mockSetWalletCreatedAt = vi.fn()
export const mockSetBackupStatus = vi.fn()

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
    refreshAvailableWallets: mockRefreshAvailableWallets,
    initializeWallet: vi.fn().mockResolvedValue(undefined),
  }))
}))

vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    setWalletCreatedAt: mockSetWalletCreatedAt,
    setBackupStatus: mockSetBackupStatus,
  }))
}))

vi.mock('src/utils/dbUtils', () => ({
  namedWalletExistsInDb: mockNamedWalletExistsInDb
}))

vi.mock('mainnet-js', () => ({
  Wallet: {
    named: mockWalletNamed,
    replaceNamed: mockWalletReplaceNamed,
  },
  TestNetWallet: {
    replaceNamed: mockTestNetWalletReplaceNamed,
  },
  Config: {
    DefaultParentDerivationPath: '',
  }
}))
