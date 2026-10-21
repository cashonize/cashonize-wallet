import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'
import type * as CauldronPools from '../src/utils/defi/cauldronPools'

vi.mock('src/utils/defi/cauldronPools', async (importOriginal) => ({
  ...await importOriginal<typeof CauldronPools>(),
  fetchCauldronPools: vi.fn().mockResolvedValue([]),
}))
vi.mock('src/utils/defi/badgersStake', () => ({ fetchBadgerLocks: vi.fn().mockResolvedValue([]) }))

import { fetchCauldronPools } from '../src/utils/defi/cauldronPools'
import { fetchBadgerLocks } from '../src/utils/defi/badgersStake'
import { useStore } from '../src/stores/store'

function createWallet() {
  return { ...mockMainnetWallet, getUtxos: vi.fn().mockResolvedValue([]) }
}

describe('the portfolio lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    localStorageMock.clear()
    localStorageMock.setItem('network', 'mainnet')
    setActivePinia(createPinia())
  })
  afterEach(() => { vi.useRealTimers() })

  // a portfolio visit within a minute of the last lookup shows its results again
  it('looks up pools and Badgers locks again only after a minute', async () => {
    const store = useStore()
    await store.setWallet(createWallet() as never)

    await store.fetchWalletCauldronPools()
    await store.fetchWalletBadgerLocks()
    await store.fetchWalletCauldronPools()
    await store.fetchWalletBadgerLocks()
    expect(fetchCauldronPools).toHaveBeenCalledOnce()
    expect(fetchBadgerLocks).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(60_000)
    await store.fetchWalletCauldronPools()
    await store.fetchWalletBadgerLocks()
    expect(fetchCauldronPools).toHaveBeenCalledTimes(2)
    expect(fetchBadgerLocks).toHaveBeenCalledTimes(2)
  })

  // creating or withdrawing a pool or a lock moves the wallet's coins
  it('looks up again once the wallet\'s coins changed', async () => {
    const store = useStore()
    const wallet = createWallet()
    await store.setWallet(wallet as never)
    await store.fetchWalletCauldronPools()
    await store.fetchWalletBadgerLocks()

    wallet.getUtxos.mockResolvedValue([{ txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:q' }])
    await store.updateWalletUtxos()
    await store.fetchWalletCauldronPools()
    await store.fetchWalletBadgerLocks()
    expect(fetchCauldronPools).toHaveBeenCalledTimes(2)
    expect(fetchBadgerLocks).toHaveBeenCalledTimes(2)
  })

  it('looks up again for another wallet', async () => {
    const store = useStore()
    await store.setWallet(createWallet() as never)
    await store.fetchWalletCauldronPools()

    await store.resetWalletState()
    await store.setWallet(createWallet() as never)
    await store.fetchWalletCauldronPools()
    expect(fetchCauldronPools).toHaveBeenCalledTimes(2)
  })
})
