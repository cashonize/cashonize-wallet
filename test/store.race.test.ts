import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive } from 'vue'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

// Import the mocked storeUtils to control fetchTokenMetadata responses
import { fetchTokenMetadata as mockFetchTokenMetadataFromIndexer, tokenListFromUtxos as mockTokenListFromUtxos } from '../src/stores/storeUtils'

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
    getRawHistory: vi.fn().mockResolvedValue([]),
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

  // clearAllMocks keeps implementations, so one a test sets is put back here, even when it fails
  afterEach(() => {
    vi.mocked(mockTokenListFromUtxos).mockReturnValue([])
  })

  it('ignores stale getUtxos result after re-initialization', async () => {
    const staleUtxosDeferred = createDeferred<unknown[]>()
    const wallet = createMockWallet()
    wallet.getUtxos.mockImplementation(() => staleUtxosDeferred.promise)

    const store = useStore()
    await store.setWallet(wallet as never)

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

  it('ignores stale getUtxos result after resetWalletState', async () => {
    const staleUtxosDeferred = createDeferred<unknown[]>()
    const wallet = createMockWallet()
    wallet.getUtxos.mockImplementation(() => staleUtxosDeferred.promise)

    const store = useStore()
    await store.setWallet(wallet as never)

    // First init blocks at getUtxos
    const oldInit = store.initializeWallet()
    await flushAsyncWork()

    // Resetting bumps the epoch as well, so the init still in flight is stale from here on.
    // Without that bump the late result below lands after the reset cleared the state.
    await store.resetWalletState({ resetDappConnections: false })

    expect(store.walletUtxos).toBeUndefined()

    // Old deferred resolves late — should be ignored
    staleUtxosDeferred.resolve([{ satoshis: 1111n }])
    await oldInit
    await flushAsyncWork()

    expect(store.walletUtxos).toBeUndefined()
  })

  it('ignores stale getHistory result after re-initialization', async () => {
    const staleHistoryDeferred = createDeferred<unknown[]>()
    const wallet = createMockWallet()
    wallet.getHistory.mockImplementation(() => staleHistoryDeferred.promise)

    const store = useStore()
    await store.setWallet(wallet as never)

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
    await store.setWallet(createMockWallet() as never)

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

  // the history landing first must not look up a held token again: that category-only answer
  // could land after the wallet's own fetch and replace its NFTs' metadata
  it('leaves held tokens out of the history\'s metadata fetch while the metadata is loading', async () => {
    const heldNft = { category: 'held', nfts: [] }
    vi.mocked(mockTokenListFromUtxos).mockReturnValue([heldNft] as never)
    const metadataDeferred = createDeferred<Record<string, unknown>>()
    vi.mocked(mockFetchTokenMetadataFromIndexer)
      .mockReturnValueOnce(metadataDeferred.promise as never)
      .mockResolvedValue({})
    const wallet = createMockWallet()
    const tokenAmountChanges = [{ category: 'held', amount: 0n }, { category: 'spent', amount: -5n }]
    wallet.getHistory.mockResolvedValue([{ txid: 'tx', tokenAmountChanges }])

    const store = useStore()
    await store.setWallet(wallet as never)
    const init = store.initializeWallet()
    await flushAsyncWork()

    expect(vi.mocked(mockFetchTokenMetadataFromIndexer).mock.calls.map(call => call[0])).toEqual([
      [heldNft],
      [{ category: 'spent', amount: 0n }],
    ])

    metadataDeferred.resolve({})
    await init
  })
})

describe('partial history loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls getHistory with count: 100 during init', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect(wallet.getHistory).toHaveBeenCalledWith({ count: 100 })
  })

  it('sets isHistoryPartial when the history holds more than was loaded', async () => {
    const wallet = createMockWallet()
    const items100 = Array.from({ length: 100 }, (_, i) => ({ txid: `tx-${i}` }))
    wallet.getHistory.mockResolvedValueOnce(items100)
    wallet.getRawHistory.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ tx_hash: `tx-${i}`, height: i + 1 })))

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect(store.isHistoryPartial).toBe(true)
    expect(store.walletHistory).toEqual(items100)
  })

  // a deep ref would proxy every input and output of every item the views read
  it('keeps the history items out of Vue\'s reactivity', async () => {
    const wallet = createMockWallet()
    wallet.getHistory.mockResolvedValueOnce([{ txid: 'tx', inputs: [], outputs: [] }])

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect(isReactive(store.walletHistory![0])).toBe(false)
  })

  it('does not set isHistoryPartial when fewer items returned', async () => {
    const wallet = createMockWallet()
    const items50 = Array.from({ length: 50 }, (_, i) => ({ txid: `tx-${i}` }))
    wallet.getHistory.mockResolvedValueOnce(items50)

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect(store.isHistoryPartial).toBe(false)
    expect(store.walletHistory).toEqual(items50)
  })

  it('does not load the full history on its own', async () => {
    vi.useFakeTimers()
    const wallet = createMockWallet()
    wallet.getHistory.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ txid: `tx-${i}` })))
    wallet.getRawHistory.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ tx_hash: `tx-${i}`, height: i + 1 })))

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()
    await vi.advanceTimersByTimeAsync(5000)
    await store.updateWalletHistory()

    expect(store.isHistoryPartial).toBe(true)
    expect(wallet.getHistory).not.toHaveBeenCalledWith({ count: -1 })
  })

  // what only asks whether a transaction is the wallet's must not depend on how much is loaded
  it('knows every txid of the history while only a page is loaded', async () => {
    const wallet = createMockWallet()
    wallet.getHistory.mockResolvedValue([{ hash: 'new' }])
    wallet.getRawHistory.mockResolvedValue([{ tx_hash: 'new', height: 3 }, { tx_hash: 'old', height: 1 }])

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect([...store.walletTxids]).toEqual(['new', 'old'])
  })

  it('loads the full history when asked, and a send or receive merges the newest page into it', async () => {
    const wallet = createMockWallet()
    const full = Array.from({ length: 500 }, (_, i) => ({ hash: `tx-${i}` }))
    wallet.getRawHistory.mockResolvedValue(full.map((item, i) => ({ tx_hash: item.hash, height: 500 - i })))
    wallet.getHistory.mockResolvedValueOnce(full.slice(0, 100)).mockResolvedValueOnce(full)

    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()
    await store.loadAllHistory()

    expect(store.isHistoryPartial).toBe(false)
    expect(store.walletHistory).toEqual(full)
    const received = { hash: 'received' }
    wallet.getRawHistory.mockResolvedValue([{ tx_hash: 'received', height: 0 }, ...full.map((item, i) => ({ tx_hash: item.hash, height: 500 - i }))])
    wallet.getHistory.mockClear().mockResolvedValueOnce([received, ...full.slice(0, 99)])
    await store.updateWalletHistory()
    expect(wallet.getHistory).not.toHaveBeenCalledWith({ count: -1 })
    expect(store.walletHistory).toEqual([received, ...full])
  })

  // the views stay alive, so the history view becoming active is what asks, for each wallet
  it('loads the full history when the history view shows, and again for the next wallet', async () => {
    const store = useStore()
    for (const wallet of [createMockWallet(), createMockWallet()]) {
      await store.setWallet(wallet as never)
      await store.initializeWallet()
      store.changeView(3)
      await flushAsyncWork()
      expect(wallet.getHistory).toHaveBeenCalledWith({ count: -1 })
    }
  })

  it('discards stale history when newer updateWalletHistory completes first', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    // Start a slow refresh of the loaded page
    const staleDeferred = createDeferred<unknown[]>()
    wallet.getHistory.mockImplementationOnce(() => staleDeferred.promise)
    const slowCall = store.updateWalletHistory()

    // Start and complete a fast capped fetch (bumps historyRequestId), which goes around the shared refresh
    const freshHistory = [{ txid: 'fresh' }]
    wallet.getHistory.mockResolvedValueOnce(freshHistory)
    await store.updateWalletHistory({ count: 100 })

    expect(store.walletHistory).toEqual(freshHistory)

    // Slow call resolves late — should be discarded by historyRequestId guard
    staleDeferred.resolve([{ txid: 'stale' }])
    await slowCall
    await flushAsyncWork()

    expect(store.walletHistory).toEqual(freshHistory)
  })
})

// A send or receive refreshes the history two or three times; each load decodes the loaded
// transactions again, so they share one load, rerun for refreshes asked meanwhile.
describe('history refreshes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('shares one load and reruns it once for refreshes asked for meanwhile', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()
    wallet.getHistory.mockClear()

    const first = createDeferred<unknown[]>()
    const latest = [{ txid: 'latest' }]
    wallet.getHistory.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(latest)
    const refreshes = [store.updateWalletHistory(), store.updateWalletHistory(), store.updateWalletHistory()]
    first.resolve([{ txid: 'older' }])
    await Promise.all(refreshes)

    expect(wallet.getHistory).toHaveBeenCalledTimes(2)
    expect(store.walletHistory).toEqual(latest)
  })

  // the export reads what is loaded once asking for all returns, so that must be all of it
  it('ends with the full history when asked for it during a page refresh', async () => {
    const wallet = createMockWallet()
    wallet.getRawHistory.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ tx_hash: `tx-${i}`, height: i + 1 })))
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    const page = createDeferred<unknown[]>()
    const full = Array.from({ length: 500 }, (_, i) => ({ txid: `tx-${i}` }))
    wallet.getHistory.mockImplementationOnce(() => page.promise)
      .mockImplementation(({ count }: { count: number }) => Promise.resolve(count === -1 ? full : full.slice(0, 100)))
    // the refreshes of a send or receive, the second asking the page to load again
    void store.updateWalletHistory()
    void store.updateWalletHistory()
    const asked = store.loadAllHistory()
    page.resolve(full.slice(0, 100))
    await asked

    expect(store.isHistoryPartial).toBe(false)
    expect(store.walletHistory).toEqual(full)
  })

  it('does not apply a load of the previous wallet, nor share it with the next', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    const stale = createDeferred<unknown[]>()
    wallet.getHistory.mockImplementationOnce(() => stale.promise)
    void store.updateWalletHistory()
    const fresh = [{ txid: 'fresh' }]
    wallet.getHistory.mockResolvedValue(fresh)
    await store.initializeWallet()
    await store.updateWalletHistory()
    expect(store.walletHistory).toEqual(fresh)
  })
})

// The subscriptions go live once their initial burst has passed, before the metadata and the
// history have loaded: a payment arriving in that window updates the balance rather than waiting
// on an indexer, and a first metadata fetch it starts merges into the init's rather than replacing it.
describe('subscriptions live before metadata and history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('applies a balance change while the metadata fetch is still pending', async () => {
    const wallet = createMockWallet()
    let balanceCallback: ((balance: bigint) => void) | undefined
    wallet.watchBalance.mockImplementation((callback: (balance: bigint) => void) => {
      balanceCallback = callback
      return Promise.resolve(async () => {})
    })
    const metadata = createDeferred<Record<string, unknown>>()
    vi.mocked(mockFetchTokenMetadataFromIndexer).mockImplementationOnce(() => metadata.promise as never)
    const store = useStore()
    await store.setWallet(wallet as never)

    const init = store.initializeWallet()
    await flushAsyncWork()
    expect(balanceCallback).toBeDefined()
    expect(wallet.getUtxos).toHaveBeenCalledTimes(1)

    balanceCallback!(5000n)
    await flushAsyncWork()

    expect(wallet.getUtxos).toHaveBeenCalledTimes(2)
    metadata.resolve({})
    await init
  })

  it('merges a second first-time metadata fetch into the first', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    const first = createDeferred<Record<string, unknown>>()
    const second = createDeferred<Record<string, unknown>>()
    vi.mocked(mockFetchTokenMetadataFromIndexer)
      .mockImplementationOnce(() => first.promise as never)
      .mockImplementationOnce(() => second.promise as never)

    const init = store.initializeWallet()
    await flushAsyncWork()
    const secondFetch = store.fetchTokenMetadata([], false)
    // both started while the registries were undefined, and land in either order
    second.resolve({ bbbb: { name: 'B' } })
    await secondFetch
    first.resolve({ aaaa: { name: 'A' } })
    await init

    expect(Object.keys(store.bcmrRegistries ?? {}).sort()).toEqual(['aaaa', 'bbbb'])
  })
})
