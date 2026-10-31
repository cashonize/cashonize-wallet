import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { InOutput, TransactionHistoryItem, Utxo } from '@cashonize/bch-wallet-lib'

import { localStorageMock, mockMainnetWallet, utxoWatch } from './mocks/store.mocks'
// after the store mocks, which mock quasar and the stores
import { Notify } from 'quasar'
import { tokenListFromUtxos } from '../src/stores/storeUtils'
import { useCashconnectStore } from '../src/stores/cashconnectStore'
import { useStore } from '../src/stores/store'

const own = 'bitcoincash:qown'
const other = 'bitcoincash:qother'
const category = 'cc'.repeat(32)

const coin = (txByte: string, satoshis: bigint, token?: Utxo['token']): Utxo =>
  ({ txid: txByte.repeat(32), vout: 0, satoshis, address: own, ...(token ? { token } : {}) })
const nft = { category, amount: 0n, nft: { capability: 'none' as const, commitment: '01' } }

const output = (address: string, value: number, token?: InOutput['token']): InOutput => ({ address, value, ...(token ? { token } : {}) })
// A history item as the library decodes it, its changes counted over the outputs to this wallet
function transaction(txByte: string, inputs: InOutput[], outputs: InOutput[]): TransactionHistoryItem {
  const mine = (io: InOutput) => io.address === own
  const valueChange = outputs.filter(mine).reduce((sum, io) => sum + io.value, 0)
    - inputs.filter(mine).reduce((sum, io) => sum + io.value, 0)
  const tokenAmountChanges = outputs.filter(io => mine(io) && io.token).map(io => ({
    category: io.token!.category, amount: io.token!.amount, nftAmount: io.token!.nft ? 1n : 0n,
  }))
  return { hash: txByte.repeat(32), inputs, outputs, blockHeight: 0, size: 200, fee: 200, balance: 0, valueChange, tokenAmountChanges }
}

function createWallet(startCoins: Utxo[]) {
  const watch = utxoWatch()
  const wallet = {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue(startCoins),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    getHistory: vi.fn().mockResolvedValue([]),
    getRawHistory: vi.fn().mockResolvedValue([]),
    watchUtxos: watch.watchUtxos,
    watchBlocks: vi.fn().mockResolvedValue(async () => {}),
    hasAddress: vi.fn((address: string) => address === own),
    provider: {},
  }
  // a change as the library reports it, with the history the store reads after it
  const change = (utxos: Utxo[], added: Utxo[], removed: Utxo[], history: TransactionHistoryItem[]) => {
    wallet.getHistory.mockResolvedValue(history)
    wallet.getRawHistory.mockResolvedValue(history.map(item => ({ tx_hash: item.hash, height: 0 })))
    return watch.change({ utxos, added, removed })
  }
  return { wallet, change }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const notices = () => vi.mocked(Notify.create).mock.calls.map(([options]) => options as { type?: string, message?: string })
const receivedTokens = () => notices().filter(notice => notice.message?.startsWith('Received new'))
const receivedBch = () => notices().filter(notice => notice.message?.startsWith('Received') && !notice.message.startsWith('Received new'))

async function openWallet(startCoins: Utxo[]) {
  const { wallet, change } = createWallet(startCoins)
  const store = useStore()
  await store.setWallet(wallet as never)
  await store.initializeWallet()
  return { store, wallet, change }
}

describe('the coin watch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('opens the wallet on the watch\'s first read, reading no coins of its own beyond it and announcing none', async () => {
    const start = [coin('aa', 5000n)]
    const { store, wallet } = await openWallet(start)
    await flush()

    expect(store.walletUtxos).toEqual(start)
    expect(wallet.getUtxos).toHaveBeenCalledTimes(1)
    expect(notices().filter(notice => notice.type === 'positive')).toHaveLength(0)
  })

  // the library makes the watch before its first read, so a payment landing during startup is a change
  it('announces a payment that arrives while the wallet is still opening', async () => {
    const { wallet, change } = createWallet([])
    const store = useStore()
    await store.setWallet(wallet as never)
    const init = store.initializeWallet()
    await flush()

    const payment = coin('bb', 5000n)
    await change([payment], [payment], [], [transaction('bb', [output(other, 6000)], [output(own, 5000)])])
    await init
    await flush()

    expect(store.walletUtxos).toEqual([payment])
    expect(receivedBch()).toHaveLength(1)
  })

  it('announces an NFT once, without its dust as received BCH', async () => {
    const { change } = await openWallet([])
    const received = coin('bb', 1000n, nft)
    await change([received], [received], [], [transaction('bb', [output(other, 3000)], [output(own, 1000, nft), output(other, 1800)])])
    await flush()

    expect(receivedTokens()).toHaveLength(1)
    expect(receivedBch()).toHaveLength(0)
  })

  // an older receipt in the refreshed history brought no coin in this change
  it('announces one transaction once, however many outputs pay the wallet, and no older one', async () => {
    const { change } = await openWallet([])
    const first = coin('bb', 1000n, nft)
    const second = { ...coin('bb', 1000n, { ...nft, nft: { capability: 'none' as const, commitment: '02' } }), vout: 1 }
    const bch = { ...coin('bb', 4000n), vout: 2 }
    const outputs = [output(own, 1000, first.token), output(own, 1000, second.token), output(own, 4000)]
    const older = transaction('dd', [output(other, 9000)], [output(own, 8000)])
    await change([first, second, bch], [first, second, bch], [], [transaction('bb', [output(other, 7000)], outputs), older])
    await flush()

    expect(receivedTokens()).toHaveLength(1)
    expect(receivedBch()).toHaveLength(1)
  })

  // an HD wallet's debounce can split the coins of one transaction over two callbacks
  it('announces a transaction once when its coins arrive in two callbacks', async () => {
    const { change } = await openWallet([])
    const first = coin('bb', 4000n)
    const second = { ...coin('bb', 3000n), vout: 1 }
    const payment = transaction('bb', [output(other, 8000)], [output(own, 4000), output(own, 3000)])
    await change([first], [first], [], [payment])
    await change([first, second], [second], [], [payment])
    await flush()

    expect(receivedBch()).toHaveLength(1)
  })

  // the same keys open elsewhere: the change of a send made there is no payment
  it('does not announce the change of a send from this wallet, also one made on another device', async () => {
    const spent = coin('aa', 10_000n)
    const { change } = await openWallet([spent])
    const tokenChange = coin('bb', 1000n, { category, amount: 5n })
    const bchChange = { ...coin('bb', 7000n), vout: 1 }
    const send = transaction('bb', [output(own, 10_000)], [output(other, 1000), output(own, 1000, tokenChange.token), output(own, 7000)])
    await change([tokenChange, bchChange], [tokenChange, bchChange], [spent], [send])
    await flush()

    expect(notices().filter(notice => notice.type === 'positive')).toHaveLength(0)
  })

  it('rebuilds the token list when a token coin disappears', async () => {
    const tokenCoin = coin('aa', 1000n, nft)
    const { store, change } = await openWallet([tokenCoin])
    vi.mocked(tokenListFromUtxos).mockClear()

    await change([], [], [tokenCoin], [])

    expect(store.walletUtxos).toEqual([])
    expect(vi.mocked(tokenListFromUtxos)).toHaveBeenCalledWith([], expect.anything())
  })

  it('tells CashConnect on every change, confirmations included, and not on the first callback', async () => {
    const notifyBalancesChanged = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useCashconnectStore).mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      cashConnectWallet: { notifyBalancesChanged },
    } as never)
    const { change } = await openWallet([])
    expect(notifyBalancesChanged).not.toHaveBeenCalled()

    const payment = coin('bb', 5000n)
    await change([payment], [payment], [], [])
    // a confirmation: the coins stay the same
    await change([payment], [], [], [])

    expect(notifyBalancesChanged).toHaveBeenCalledTimes(2)
  })

  // the watch of an initialization a newer one overtook must not take the newer one's place
  it('cancels the watch of an overtaken initialization and keeps the newer one', async () => {
    const { wallet } = createWallet([])
    let releaseFirst!: () => void
    const firstRead = new Promise<void>(resolve => { releaseFirst = resolve })
    const cancelFirst = vi.fn(() => Promise.resolve())
    const cancelSecond = vi.fn(() => Promise.resolve())
    wallet.watchUtxos
      .mockImplementationOnce(async (callback: (change: { utxos: Utxo[], added: Utxo[], removed: Utxo[] }) => unknown) => {
        await firstRead
        void callback({ utxos: [], added: [], removed: [] })
        return cancelFirst
      })
      .mockImplementationOnce((callback: (change: { utxos: Utxo[], added: Utxo[], removed: Utxo[] }) => unknown) => {
        void callback({ utxos: [], added: [], removed: [] })
        return Promise.resolve(cancelSecond)
      })
    const store = useStore()
    await store.setWallet(wallet as never)
    const overtaken = store.initializeWallet()
    await flush()
    await store.initializeWallet()
    releaseFirst()
    await overtaken
    expect(cancelFirst).toHaveBeenCalledOnce()

    await store.resetWalletState({ resetDappConnections: false })

    expect(cancelSecond).toHaveBeenCalledOnce()
  })
})
