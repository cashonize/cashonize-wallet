import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'
// after the store mocks, which mock quasar
import { Notify } from 'quasar'
import { useStore } from '../src/stores/store'

type BalanceCallback = (balance: bigint) => Promise<void>

const coin = { txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n }

function createWallet() {
  let onBalance: BalanceCallback | undefined
  const wallet = {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue([coin]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    getHistory: vi.fn().mockResolvedValue([]),
    getRawHistory: vi.fn().mockResolvedValue([]),
    watchBalance: vi.fn().mockImplementation((callback: BalanceCallback) => {
      onBalance = callback
      return Promise.resolve(async () => {})
    }),
    watchTokenTransactions: vi.fn().mockResolvedValue(async () => {}),
    watchBlocks: vi.fn().mockResolvedValue(async () => {}),
    hasAddress: vi.fn().mockReturnValue(false),
    provider: { connect: vi.fn().mockResolvedValue(undefined) },
  }
  return { wallet, balanceChanged: (balance: bigint) => onBalance!(balance) }
}

const refreshWarnings = () => vi.mocked(Notify.create).mock.calls
  .map(([options]) => options as { group?: string })
  .filter(options => options.group === 'walletRefreshFailed')

describe('refresh failure notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('warns when a refresh fails, keeping the old coins', async () => {
    const { wallet } = createWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()
    expect(refreshWarnings()).toHaveLength(0)

    wallet.getUtxos.mockRejectedValue(new Error('server'))
    await store.updateWalletUtxos()

    expect(store.walletUtxos).toEqual([coin])
    expect(refreshWarnings()).toHaveLength(1)
  })

  it('warns when the refresh after an incoming payment fails', async () => {
    const { wallet, balanceChanged } = createWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    wallet.getUtxos.mockRejectedValue(new Error('server'))
    await balanceChanged(500n)

    expect(refreshWarnings()).toHaveLength(1)
    expect(store.walletUtxos).toEqual([coin])
  })

  it('stays quiet about a refresh that fails after the wallet was switched', async () => {
    const { wallet } = createWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    let rejectRefresh!: (error: Error) => void
    wallet.getUtxos.mockReturnValue(new Promise((_, reject) => { rejectRefresh = reject }))
    const refresh = store.updateWalletUtxos()
    await store.resetWalletState({ resetDappConnections: false })
    rejectRefresh(new Error('server'))
    await refresh

    expect(refreshWarnings()).toHaveLength(0)
  })

  it("keeps a refresh that lands after the wallet was switched out of the new wallet's coins", async () => {
    const { wallet } = createWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    let resolveRefresh!: (utxos: typeof coin[]) => void
    wallet.getUtxos.mockReturnValue(new Promise(resolve => { resolveRefresh = resolve }))
    const refresh = store.updateWalletUtxos()
    await store.resetWalletState({ resetDappConnections: false })
    resolveRefresh([coin])
    await refresh

    expect(store.walletUtxos).toBeUndefined()
  })
})
