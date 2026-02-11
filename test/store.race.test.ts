import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

// Import the mocked storeUtils to control fetchTokenMetadata responses
import { fetchTokenMetadata as mockFetchTokenMetadataFromIndexer } from '../src/stores/storeUtils'

import { useStore } from '../src/stores/store'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createMockWallet() {
  return {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue([]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    getHistory: vi.fn().mockResolvedValue([]),
    watchBalance: vi.fn().mockResolvedValue(async () => {}),
    watchTokenTransactions: vi.fn().mockResolvedValue(async () => {}),
    watchBlocks: vi.fn().mockResolvedValue(async () => {}),
    hasAddress: vi.fn().mockReturnValue(false),
    provider: {
      connect: vi.fn().mockResolvedValue(undefined),
      getRawTransactionObject: vi.fn().mockResolvedValue({ vin: [], vout: [] }),
    },
  }
}

async function flushAsyncWork() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('network switch race conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('ignores stale getUtxos result after re-initialization', async () => {
    const staleUtxosDeferred = createDeferred<unknown[]>()
    const wallet = createMockWallet()
    wallet.getUtxos.mockImplementation(() => staleUtxosDeferred.promise)

    const store = useStore()
    store.setWallet(wallet as never)

    // First init blocks at getUtxos
    const oldInit = store.initializeWallet()
    await flushAsyncWork()

    // Swap to instant response and re-initialize (bumps epoch)
    const freshUtxos = [{ satoshis: 2222n }]
    wallet.getUtxos.mockResolvedValue(freshUtxos)
    await store.initializeWallet()

    expect(store.walletUtxos).toEqual(freshUtxos)

    // Old deferred resolves late — should be ignored
    staleUtxosDeferred.resolve([{ satoshis: 1111n }])
    await oldInit
    await flushAsyncWork()

    expect(store.walletUtxos).toEqual(freshUtxos)
  })

  it('ignores stale getHistory result after re-initialization', async () => {
    const staleHistoryDeferred = createDeferred<unknown[]>()
    const wallet = createMockWallet()
    wallet.getHistory.mockImplementation(() => staleHistoryDeferred.promise)

    const store = useStore()
    store.setWallet(wallet as never)

    // First init blocks at getHistory
    const oldInit = store.initializeWallet()
    await flushAsyncWork()

    // Swap to instant response and re-initialize (bumps epoch)
    const freshHistory = [{ txid: 'new-tx' }]
    wallet.getHistory.mockResolvedValue(freshHistory)
    await store.initializeWallet()

    expect(store.walletHistory).toEqual(freshHistory)

    // Old deferred resolves late — should be ignored
    staleHistoryDeferred.resolve([{ txid: 'stale-tx' }])
    await oldInit
    await flushAsyncWork()

    expect(store.walletHistory).toEqual(freshHistory)
  })

  it('ignores stale fetchTokenMetadata result after re-initialization', async () => {
    const staleMetadataDeferred = createDeferred<Record<string, unknown>>()
    const freshMetadata = { 'newTokenId': { name: 'NewToken' } }
    // First call (old init) uses deferred, second call (new init) resolves immediately
    vi.mocked(mockFetchTokenMetadataFromIndexer)
      .mockReturnValueOnce(staleMetadataDeferred.promise as never)
      .mockResolvedValueOnce(freshMetadata as never)

    const store = useStore()
    store.setWallet(createMockWallet() as never)

    // First init blocks at fetchTokenMetadata
    const oldInit = store.initializeWallet()
    await flushAsyncWork()

    // Re-initialize (bumps epoch)
    await store.initializeWallet()

    expect(store.bcmrRegistries).toEqual(freshMetadata)

    // Old deferred resolves late — should be ignored
    staleMetadataDeferred.resolve({ 'staleTokenId': { name: 'StaleToken' } })
    await oldInit
    await flushAsyncWork()

    expect(store.bcmrRegistries).toEqual(freshMetadata)
  })
})
