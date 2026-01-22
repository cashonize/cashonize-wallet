/**
 * Browser tests for store initial state.
 * Tests invariants that the UI depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStore } from 'src/stores/store'
import { localStorageMock } from './setup'

describe('Store Initial State', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorageMock.store = {}
  })

  it('displayView is undefined initially (triggers onboarding)', () => {
    const store = useStore()
    expect(store.displayView).toBe(undefined)
  })

  it('activeWalletName defaults to "mywallet"', () => {
    const store = useStore()
    expect(store.activeWalletName).toBe('mywallet')
  })

  it('activeWalletName hydrates from localStorage', () => {
    localStorageMock.store['activeWalletName'] = 'customWallet'
    setActivePinia(createPinia())

    const store = useStore()
    expect(store.activeWalletName).toBe('customWallet')
  })

  it('wallet state is empty before initialization', () => {
    const store = useStore()

    expect(store._wallet).toBe(null)
    expect(store.balance).toBe(undefined)
    expect(store.tokenList).toBe(null)
    expect(store.walletUtxos).toBe(undefined)
    expect(store.availableWallets).toEqual([])
  })
})
