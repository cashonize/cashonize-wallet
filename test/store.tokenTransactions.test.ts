import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'
// after the store mocks, which mock quasar
import { Notify } from 'quasar'
import { useStore } from '../src/stores/store'

type TokenTxCallback = (tx: unknown) => Promise<void>

const held = 'aa'.repeat(32)
const tokenAddress = 'bitcoincash:zqheld'

function walletWithCoin() {
  let onTokenTx: TokenTxCallback | undefined
  const wallet = {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue([{ txid: held, vout: 1, satoshis: 1000n }]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    getHistory: vi.fn().mockResolvedValue([]),
    getRawHistory: vi.fn().mockResolvedValue([]),
    watchBalance: vi.fn().mockResolvedValue(async () => {}),
    watchTokenTransactions: vi.fn().mockImplementation((callback: TokenTxCallback) => {
      onTokenTx = callback
      return Promise.resolve(async () => {})
    }),
    watchBlocks: vi.fn().mockResolvedValue(async () => {}),
    hasAddress: vi.fn((address: string) => address === tokenAddress),
    provider: { connect: vi.fn().mockResolvedValue(undefined) },
  }
  return { wallet, receive: (tx: unknown) => onTokenTx!(tx) }
}

// A token transaction paying this wallet, spending the given outpoint
const tokenTx = (spends: { txid: string, vout: number }) => ({
  txid: 'bb'.repeat(32),
  vin: [spends],
  vout: [{ n: 0, value: 0.00001, scriptPubKey: { addresses: [tokenAddress] }, tokenData: { category: 'cc'.repeat(32), amount: '5' } }],
})

describe('token transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  // a refresh can drop the spent coin before the transaction that spent it arrives
  it('announces tokens paid from coins it never held, not change from a coin it held', async () => {
    const { wallet, receive } = walletWithCoin()
    const store = useStore()
    await store.setWallet(wallet as never)
    await store.initializeWallet()
    wallet.getUtxos.mockResolvedValue([])
    await store.updateWalletUtxos()

    await receive(tokenTx({ txid: held, vout: 1 }))
    await receive(tokenTx({ txid: 'dd'.repeat(32), vout: 0 }))

    const announced = vi.mocked(Notify.create).mock.calls.filter(([options]) => (options as { type?: string }).type === 'positive')
    expect(announced).toHaveLength(1)
  })
})
