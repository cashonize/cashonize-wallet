import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'

import { tokenListFromUtxos } from '../src/stores/storeUtils'
import { useStore } from '../src/stores/store'

function createWallet() {
  return { ...mockMainnetWallet, getUtxos: vi.fn().mockResolvedValue([]) }
}

describe('the token list', () => {
  const category = '0123456789abcdef'.repeat(4)

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  // a refresh of the wallet's coins after a send used to replace an identical list
  it('keeps the same list when a refresh finds the same tokens, and replaces it when they changed', async () => {
    const store = useStore()
    await store.setWallet(createWallet() as never)
    vi.mocked(tokenListFromUtxos).mockImplementation(() => [{ category, amount: 5n }])

    await store.updateWalletUtxos()
    const first = store.tokenList
    await store.updateWalletUtxos()
    expect(store.tokenList).toBe(first)

    vi.mocked(tokenListFromUtxos).mockImplementation(() => [{ category, amount: 4n }])
    await store.updateWalletUtxos()
    expect(store.tokenList).not.toBe(first)
    expect(store.tokenList).toEqual([{ category, amount: 4n }])
  })
})
