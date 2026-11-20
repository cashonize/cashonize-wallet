import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'
import type * as RunManifest from '../src/utils/contracts/runManifest'

vi.mock('src/utils/contracts/runManifest', async (importOriginal) => ({
  ...await importOriginal<typeof RunManifest>(),
  runManifest: vi.fn().mockResolvedValue([]),
}))

import { runManifest } from '../src/utils/contracts/runManifest'
import { LIQUIDITY_POOL_MANIFESTS } from '../src/utils/contracts/builtins'
import { useStore } from '../src/stores/store'

// how often the manifests of one kind of position were run
function lookups(manifestIds: string[]) {
  return vi.mocked(runManifest).mock.calls.filter(([manifest]) => manifestIds.includes(manifest.id)).length
}
const poolLookups = () => lookups(LIQUIDITY_POOL_MANIFESTS) / LIQUIDITY_POOL_MANIFESTS.length
const badgerLookups = () => lookups(['badgers-stake'])

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

    await store.fetchWalletLiquidityPools()
    await store.fetchWalletBadgerLocks()
    await store.fetchWalletLiquidityPools()
    await store.fetchWalletBadgerLocks()
    expect(poolLookups()).toBe(1)
    expect(badgerLookups()).toBe(1)

    vi.advanceTimersByTime(60_000)
    await store.fetchWalletLiquidityPools()
    await store.fetchWalletBadgerLocks()
    expect(poolLookups()).toBe(2)
    expect(badgerLookups()).toBe(2)
  })

  // creating or withdrawing a pool or a lock moves the wallet's coins
  it('looks up again once the wallet\'s coins changed', async () => {
    const store = useStore()
    const wallet = createWallet()
    await store.setWallet(wallet as never)
    await store.fetchWalletLiquidityPools()
    await store.fetchWalletBadgerLocks()

    wallet.getUtxos.mockResolvedValue([{ txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:q' }])
    await store.updateWalletUtxos()
    await store.fetchWalletLiquidityPools()
    await store.fetchWalletBadgerLocks()
    expect(poolLookups()).toBe(2)
    expect(badgerLookups()).toBe(2)
  })

  it('looks up again for another wallet', async () => {
    const store = useStore()
    await store.setWallet(createWallet() as never)
    await store.fetchWalletLiquidityPools()

    await store.resetWalletState()
    await store.setWallet(createWallet() as never)
    await store.fetchWalletLiquidityPools()
    expect(poolLookups()).toBe(2)
  })
})
