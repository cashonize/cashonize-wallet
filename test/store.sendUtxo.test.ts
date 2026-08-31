import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Utxo } from 'mainnet-js'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'

function createMockWallet() {
  return {
    ...mockMainnetWallet,
    getUtxos: vi.fn().mockResolvedValue([]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    sendMax: vi.fn().mockResolvedValue({ txId: 'sent-tx' }),
  }
}

const coin = {
  txid: 'ab'.repeat(32),
  vout: 0,
  satoshis: 100_000n,
  address: 'bitcoincash:qtest',
} as Utxo

describe('spend.sendUtxo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('refuses a pledge-reserved coin without spending anything', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    store.setWallet(wallet as never)
    await store.reserveUtxo(coin, 'pledge')

    await expect(store.spend.sendUtxo(coin, 'bitcoincash:qdest')).rejects.toThrow()
    expect(wallet.sendMax).not.toHaveBeenCalled()
    expect(outpointOf(coin) in store.reservedUtxos).toBe(true)
  })

  it('spends a frozen coin as a pool of only that coin and drops its reservation', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    store.setWallet(wallet as never)
    await store.reserveUtxo(coin, 'manual')

    const response = await store.spend.sendUtxo(coin, 'bitcoincash:qdest')

    expect(wallet.sendMax).toHaveBeenCalledWith('bitcoincash:qdest', { utxoIds: [coin] })
    expect(response.txId).toBe('sent-tx')
    expect(store.reservedUtxos).toEqual({})
  })

  it('keeps the reservation when the broadcast fails', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    store.setWallet(wallet as never)
    await store.reserveUtxo(coin, 'manual')
    wallet.sendMax.mockRejectedValue(new Error('broadcast failed'))

    await expect(store.spend.sendUtxo(coin, 'bitcoincash:qdest')).rejects.toThrow('broadcast failed')
    expect(outpointOf(coin) in store.reservedUtxos).toBe(true)
  })
})
