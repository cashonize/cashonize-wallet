import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Utxo } from 'mainnet-js'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'

const category = '0123456789abcdef'.repeat(4)

const bchCoin: Utxo = { txid: 'aa'.repeat(32), vout: 0, satoshis: 100_000n, address: 'bitcoincash:qtest' }
const tokenCoin: Utxo = {
  txid: 'bb'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
  token: { category, amount: 500n },
}
const otherTokenCoin: Utxo = {
  txid: 'cc'.repeat(32), vout: 1, satoshis: 1000n, address: 'bitcoincash:qtest',
  token: { category, amount: 700n },
}

const walletCoins = [bchCoin, tokenCoin, otherTokenCoin]

function createMockWallet() {
  return {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue(walletCoins),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    send: vi.fn().mockResolvedValue({ txId: 'sent-tx' }),
    tokenMint: vi.fn().mockResolvedValue({ txId: 'mint-tx' }),
    tokenBurn: vi.fn().mockResolvedValue({ txId: 'burn-tx' }),
  }
}

// The pool a spend was narrowed to, as the store handed it to mainnet-js
function poolOf(call: unknown[]) {
  const options = call.at(-1) as { utxoIds?: Utxo[] } | undefined
  return options?.utxoIds
}

async function storeHoldingTokenCoin() {
  const wallet = createMockWallet()
  const store = useStore()
  store.setWallet(wallet as never)
  store.walletUtxos = walletCoins
  await store.reserveUtxo(tokenCoin, 'manual')
  return { wallet, store }
}

describe('spend paths narrow to the coins the wallet may spend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  // it used to refuse token coins outright: a fungible send consumed every coin of its category,
  // so a held back one could not be kept out of it
  it('holds a token coin back like any other coin', async () => {
    const { store } = await storeHoldingTokenCoin()

    expect(store.reservedUtxos[`${tokenCoin.txid}:0`]).toBe('manual')
    expect(store.spendableUtxos).toEqual([bchCoin, otherTokenCoin])
  })

  it('keeps a held back token coin out of a send', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()

    await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    expect(poolOf(wallet.send.mock.calls[0] as unknown[])).toEqual([bchCoin, otherTokenCoin])
  })

  // mainnet-js picks the minting NFT and the coins to burn itself, from the pool it is handed
  it('keeps a held back token coin out of a mint', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()

    await store.spend.tokenMint(category, [])

    expect(poolOf(wallet.tokenMint.mock.calls[0] as unknown[])).toEqual([bchCoin, otherTokenCoin])
  })

  it('keeps a held back token coin out of a burn', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()

    await store.spend.tokenBurn({ category, amount: 100n })

    expect(poolOf(wallet.tokenBurn.mock.calls[0] as unknown[])).toEqual([bchCoin, otherTokenCoin])
  })

  it('passes no pool while the wallet holds nothing back', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    store.setWallet(wallet as never)
    store.walletUtxos = walletCoins

    await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    expect(poolOf(wallet.send.mock.calls[0] as unknown[])).toBeUndefined()
  })

  // mainnet-js counts what it was handed, so its "not met" numbers read as wrong to someone
  // looking at a balance that includes the held back coins
  it('says why a spend fell short while coins are held back', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    const shortfall = Object.assign(
      new Error('Amount required was not met, 150000 satoshis needed, 100000 satoshis available'),
      { data: { required: 150_000n, available: 100_000n } },
    )
    wallet.send.mockRejectedValue(shortfall)

    await expect(store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 150_000n }]))
      .rejects.toThrow(/held back/)
  })

  it('passes an unrelated failure through untouched', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.send.mockRejectedValue(new Error('broadcast failed'))

    await expect(store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }]))
      .rejects.toThrow('broadcast failed')
  })
})
