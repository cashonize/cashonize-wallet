import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { encodeCashAddress, hexToBin } from '@bitauth/libauth'
import { BroadcastRejectedError, BroadcastTimeoutError, InsufficientFundsError, UtxoNotAvailableError, type Utxo } from '@cashonize/bch-wallet-lib'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'
import { ActionableError } from '../src/utils/errorHandling'

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
    sendMax: vi.fn().mockResolvedValue({ txId: 'sent-tx' }),
    tokenMint: vi.fn().mockResolvedValue({ txId: 'mint-tx' }),
    tokenBurn: vi.fn().mockResolvedValue({ txId: 'burn-tx' }),
    tokenGenesis: vi.fn().mockResolvedValue({ txId: 'genesis-tx' }),
    submitTransaction: vi.fn().mockResolvedValue('again-tx'),
  }
}

// The pool a spend was narrowed to, and the coins it kept out, as the store handed them to the library
function poolOf(call: unknown[]) {
  const options = call.at(-1) as { utxoIds?: Utxo[] } | undefined
  return options?.utxoIds
}
function tokenPoolOf(call: unknown[]) {
  const options = call.at(-1) as { tokenUtxoIds?: Utxo[] } | undefined
  return options?.tokenUtxoIds
}
function excludedOf(call: unknown[]) {
  const options = call.at(-1) as { excludeUtxoIds?: string[] } | undefined
  return options?.excludeUtxoIds
}

async function storeHoldingTokenCoin() {
  const wallet = createMockWallet()
  const store = useStore()
  await store.setWallet(wallet as never)
  store.walletUtxos = walletCoins
  await store.reserveOutpoints([outpointOf(tokenCoin)], 'manual')
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
    await store.spend.sendMax('bitcoincash:qdest')
    await store.spend.getMaxAmountToSend()

    for (const call of [...wallet.send.mock.calls, ...wallet.sendMax.mock.calls]) {
      expect(excludedOf(call as unknown[])).toEqual([outpointOf(tokenCoin)])
      expect(poolOf(call as unknown[])).toBeUndefined()
    }
    expect(wallet.getMaxAmountToSend).toHaveBeenCalledWith({ excludeUtxoIds: [outpointOf(tokenCoin)], excludeAddresses: [] })
  })

  // the library picks the minting NFT and the coins to burn itself, leaving the excluded ones out
  it('keeps a held back token coin out of a mint', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()

    await store.spend.tokenMint([])

    expect(excludedOf(wallet.tokenMint.mock.calls[0] as unknown[])).toEqual([outpointOf(tokenCoin)])
  })

  it('keeps a held back token coin out of a burn', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()

    await store.spend.tokenBurn({ category, amount: 100n })

    expect(excludedOf(wallet.tokenBurn.mock.calls[0] as unknown[])).toEqual([outpointOf(tokenCoin)])
  })

  // the library reads the wallet's coins itself, so the store reads none ahead of an ordinary spend
  it('reads no coins of its own before a send', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.getUtxos.mockClear()

    await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    expect(wallet.getUtxos).not.toHaveBeenCalled()
  })

  it('excludes nothing while the wallet holds nothing back', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    store.walletUtxos = walletCoins

    await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    expect(excludedOf(wallet.send.mock.calls[0] as unknown[])).toEqual([])
    expect(poolOf(wallet.send.mock.calls[0] as unknown[])).toBeUndefined()
  })

  // the library counts what it was handed, so its numbers read as wrong to someone
  // looking at a balance that includes the held back coins
  it('says why a spend fell short while coins are held back', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    const shortfall = new InsufficientFundsError(
      'Amount required was not met, 150000 satoshis needed, 100000 satoshis available',
      { asset: 'bch' },
    )
    wallet.send.mockRejectedValue(shortfall)

    await expect(store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 150_000n }]))
      .rejects.toThrow(/held back/)
  })

  it('explains no other error that merely reads like a shortfall', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.send.mockRejectedValue(new Error('Amount required was not met'))

    await expect(store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 150_000n }]))
      .rejects.toThrow(/^Amount required was not met$/)
  })

  // The one path that spends past its own reservation: its token coins are the identity output
  // and the coins the operation asked for, so a supply operation cannot sweep the circulating
  // balance into itself as change
  it('spends an identity output with no token coins but the output and the coins asked for', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    store.walletUtxos = walletCoins
    await store.reserveOutpoints([outpointOf(tokenCoin)], 'auth')
    const request = [{ cashaddr: 'bitcoincash:qdest', value: 1000n }]

    // the library narrows the pool itself, so the spend reads no coins before it sends
    wallet.getUtxos.mockClear()
    let readsBeforeSend = -1
    wallet.send.mockImplementationOnce(() => {
      readsBeforeSend = wallet.getUtxos.mock.calls.length
      return Promise.resolve({ txId: 'sent-tx' })
    })
    await store.spend.spendAuthUtxo(tokenCoin, request)
    expect(readsBeforeSend).toBe(0)
    expect(tokenPoolOf(wallet.send.mock.calls[0] as unknown[])).toEqual([tokenCoin])
    expect(poolOf(wallet.send.mock.calls[0] as unknown[])).toBeUndefined()
    expect((wallet.send.mock.calls[0] as unknown[]).at(-1)).toMatchObject({ ensureUtxos: [tokenCoin] })

    await store.spend.spendAuthUtxo(tokenCoin, request, [otherTokenCoin])
    expect(tokenPoolOf(wallet.send.mock.calls[1] as unknown[])).toEqual([tokenCoin, otherTokenCoin])
  })

  // the authhead passes its own reservation and no other: a held back coin among those asked for stays out
  it('excludes every other reservation from an identity spend', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    store.walletUtxos = walletCoins
    await store.reserveOutpoints([outpointOf(tokenCoin)], 'auth')
    await store.reserveOutpoints([outpointOf(otherTokenCoin)], 'manual')

    await store.spend.spendAuthUtxo(tokenCoin, [{ cashaddr: 'bitcoincash:qdest', value: 1000n }], [otherTokenCoin])

    expect(excludedOf(wallet.send.mock.calls[0] as unknown[])).toEqual([outpointOf(otherTokenCoin)])
  })

  // an authhead moved elsewhere since it was read is named all the same, so the library says it
  // is not available
  it('says an identity UTXO the wallet no longer holds is not available', async () => {
    const wallet = createMockWallet()
    const store = useStore()
    await store.setWallet(wallet as never)
    store.walletUtxos = walletCoins
    const movedAuthhead: Utxo = { ...tokenCoin, txid: 'dd'.repeat(32) }
    await store.reserveOutpoints([outpointOf(movedAuthhead)], 'auth')
    const notAvailable = new UtxoNotAvailableError('not found', { utxoId: outpointOf(movedAuthhead), reason: 'not-found' })
    wallet.send.mockRejectedValue(notAvailable)

    const spending = store.spend.spendAuthUtxo(movedAuthhead, [{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    await expect(spending).rejects.toThrow(/no longer in the wallet/)
    await expect(spending).rejects.toMatchObject({ cause: notAvailable })
    expect((wallet.send.mock.calls[0] as unknown[]).at(-1)).toMatchObject({ ensureUtxos: [movedAuthhead] })
  })

  it('passes an unrelated failure through untouched', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.send.mockRejectedValue(new Error('broadcast failed'))

    await expect(store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }]))
      .rejects.toThrow(/^broadcast failed$/)
  })

  // the payment may have gone out, so the user is offered the same transaction again, which can
  // never pay twice, rather than a new send
  it('offers to broadcast the same transaction again when the outcome is unknown', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    const unknown = new BroadcastTimeoutError('connection lost', { txid: 'ef'.repeat(32), transaction: '0200' })
    wallet.send.mockRejectedValue(unknown)

    const error = await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ActionableError)
    expect((error as Error).message).toMatch(/broadcast the same transaction again/)
    expect((error as Error).cause).toBe(unknown)

    await (error as ActionableError).action.run()
    expect(wallet.submitTransaction).toHaveBeenCalledWith(hexToBin('0200'))
    expect(wallet.send).toHaveBeenCalledTimes(1)
  })

  // the steps after the broadcast are part of the spend: broadcasting again runs them too
  it('runs the steps after the broadcast when it broadcasts again', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.sendMax.mockRejectedValue(new BroadcastTimeoutError('timed out', { txid: 'ef'.repeat(32), transaction: '0200' }))

    const error = await store.spend.releaseReservedCoin(tokenCoin).catch((e: unknown) => e)
    expect(store.reservedUtxos[outpointOf(tokenCoin)]).toBe('manual')

    await (error as ActionableError).action.run()
    expect(store.reservedUtxos[outpointOf(tokenCoin)]).toBeUndefined()
  })

  // the identity may have moved to the unknown transaction's output 0: a send in the meantime must
  // not take it, so it is held back at once rather than only once broadcast again
  it('holds back the new authhead of an identity spend whose outcome is unknown', async () => {
    const ownAddress = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: new Uint8Array(20).fill(0x11) }).address
    const { wallet, store } = await storeHoldingTokenCoin()
    Object.assign(wallet, { hasAddress: (address: string) => address === ownAddress })
    const txid = 'ef'.repeat(32)
    wallet.send.mockRejectedValue(new BroadcastTimeoutError('timed out', { txid, transaction: '0200' }))

    await expect(store.spend.spendAuthUtxo(tokenCoin, [{ cashaddr: ownAddress, value: 1000n }])).rejects.toThrow()
    expect(store.reservedUtxos[`${txid}:0`]).toBe('auth')

    // a transfer's output 0 is not this wallet's, so there is nothing to hold back
    const otherTxid = 'ab'.repeat(32)
    wallet.send.mockRejectedValue(new BroadcastTimeoutError('timed out', { txid: otherTxid, transaction: '0200' }))
    await expect(store.spend.spendAuthUtxo(tokenCoin, [{ cashaddr: 'bitcoincash:qdest', value: 1000n }])).rejects.toThrow()
    expect(store.reservedUtxos[`${otherTxid}:0`]).toBeUndefined()
  })

  // those steps act on the wallet that made the transaction, so another one open refuses them
  it('refuses to broadcast again once another wallet is open', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    wallet.send.mockRejectedValue(new BroadcastTimeoutError('timed out', { txid: 'ef'.repeat(32), transaction: '0200' }))
    const error = await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }]).catch((e: unknown) => e)

    // the state a switch discards, as switching to another wallet does first
    await store.resetWalletState()
    await expect((error as ActionableError).action.run()).rejects.toThrow(/Another wallet is open/)
    expect(wallet.submitTransaction).not.toHaveBeenCalled()
  })

  // the node's reject reason means nothing to a user, so they get the classified message and
  // the node's words stay on as the cause
  it('says a lost race in the user\'s terms', async () => {
    const { wallet, store } = await storeHoldingTokenCoin()
    const rejection = new BroadcastRejectedError(
      'the transaction was rejected by network rules.\n\ntxn-mempool-conflict (code 18)\n',
      { reason: 'txn-mempool-conflict' },
    )
    wallet.send.mockRejectedValue(rejection)

    const sending = store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])
    await expect(sending).rejects.toThrow(/Nothing was sent/)
    await expect(sending).rejects.toMatchObject({ cause: rejection })
  })
})

describe('a frozen address', () => {
  const frozenAddress = 'bitcoincash:qfrozen'
  const frozenBchCoin: Utxo = { txid: 'ee'.repeat(32), vout: 0, satoshis: 30_000n, address: frozenAddress }
  const frozenTokenCoin: Utxo = { ...tokenCoin, txid: 'ef'.repeat(32), address: frozenAddress }
  const coins = [...walletCoins, frozenBchCoin, frozenTokenCoin]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  async function storeWithFrozenAddress() {
    const wallet = createMockWallet()
    wallet.getUtxos.mockResolvedValue(coins)
    const store = useStore()
    await store.setWallet(wallet as never)
    store.walletUtxos = coins
    await store.freezeAddress(frozenAddress)
    return { wallet, store }
  }

  it('holds back every coin on it, and none elsewhere', async () => {
    const { store } = await storeWithFrozenAddress()

    expect(store.reservedUtxos).toEqual({
      [outpointOf(frozenBchCoin)]: 'address',
      [outpointOf(frozenTokenCoin)]: 'address',
    })
    expect(store.spendableUtxos).toEqual(walletCoins)
    // the freeze is kept by address, never written into the outpoint reservations
    expect(store.storedReservations).toEqual({})
  })

  // a coin that arrives after walletUtxos was read is only caught by the library's own check
  it('hands the address to every spend, so coins it received since are kept out too', async () => {
    const { wallet, store } = await storeWithFrozenAddress()

    await store.spend.send([{ cashaddr: 'bitcoincash:qdest', value: 1000n }])
    await store.spend.sendMax('bitcoincash:qdest')
    await store.spend.tokenMint([])
    await store.spend.tokenBurn({ category, amount: 100n })
    await store.spend.tokenGenesis(bchCoin, { amount: 1n })
    await store.spend.getMaxAmountToSend()

    const calls = [
      ...wallet.send.mock.calls, ...wallet.sendMax.mock.calls, ...wallet.tokenMint.mock.calls,
      ...wallet.tokenBurn.mock.calls, ...wallet.tokenGenesis.mock.calls, ...wallet.getMaxAmountToSend.mock.calls,
    ]
    expect(wallet.tokenGenesis).toHaveBeenCalledOnce()
    for (const call of calls) {
      expect((call as unknown[]).at(-1)).toMatchObject({ excludeAddresses: [frozenAddress] })
    }
  })

  // a feature's reservation is released through that feature, which an unfreeze must not bypass
  it('leaves a coin a feature holds under that feature\'s reason, also after unfreezing', async () => {
    const { store } = await storeWithFrozenAddress()
    await store.reserveOutpoints([outpointOf(frozenTokenCoin)], 'auth')

    expect(store.reservedUtxos[outpointOf(frozenTokenCoin)]).toBe('auth')

    await store.unfreezeAddress(frozenAddress)
    expect(store.reservedUtxos).toEqual({ [outpointOf(frozenTokenCoin)]: 'auth' })
    expect(store.spendableUtxos).toEqual([...walletCoins, frozenBchCoin])
  })

  // the identity coin's reservation is what holds it, so its operations still reach it, while
  // the other coins on its address stay out
  it('lets an identity spend take its own coin off a frozen address, and nothing else there', async () => {
    const { wallet, store } = await storeWithFrozenAddress()
    await store.reserveOutpoints([outpointOf(frozenTokenCoin)], 'auth')

    await store.spend.spendAuthUtxo(frozenTokenCoin, [{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    const options = (wallet.send.mock.calls[0] as unknown[]).at(-1)
    expect(options).toMatchObject({ excludeAddresses: [], ensureUtxos: [frozenTokenCoin] })
    expect(excludedOf(wallet.send.mock.calls[0] as unknown[])).toEqual([outpointOf(frozenBchCoin)])
  })

  // the address leaves excludeAddresses there, so its coins are read fresh rather than from walletUtxos
  it('keeps a coin that reached the identity coin\'s frozen address since the last refresh out', async () => {
    const { wallet, store } = await storeWithFrozenAddress()
    await store.reserveOutpoints([outpointOf(frozenTokenCoin)], 'auth')
    const arrived: Utxo = { txid: 'fa'.repeat(32), vout: 0, satoshis: 40_000n, address: frozenAddress }
    wallet.getUtxos.mockResolvedValue([...coins, arrived])

    await store.spend.spendAuthUtxo(frozenTokenCoin, [{ cashaddr: 'bitcoincash:qdest', value: 1000n }])

    expect(excludedOf(wallet.send.mock.calls[0] as unknown[])).toEqual([outpointOf(frozenBchCoin), outpointOf(arrived)])
  })

  // a per-coin unfreeze must not undo the address freeze one coin at a time
  it('takes over a coin the user froze on its own', async () => {
    const { store } = await storeWithFrozenAddress()
    await store.reserveOutpoints([outpointOf(frozenBchCoin)], 'manual')

    expect(store.reservedUtxos[outpointOf(frozenBchCoin)]).toBe('address')
  })

  // refused before the library is asked, as it would put another coin first and create a
  // category nobody chose
  it('keeps a token genesis off a coin on the address', async () => {
    const { store } = await storeWithFrozenAddress()

    await expect(store.spend.tokenGenesis(frozenBchCoin, { amount: 1n })).rejects.toThrow(/no longer available/)
  })

  it('stays frozen for the next session of the same wallet', async () => {
    await storeWithFrozenAddress()

    setActivePinia(createPinia())
    const store = useStore()
    await store.setWallet(createMockWallet() as never)
    store.walletUtxos = coins

    expect(store.frozenAddresses).toEqual([frozenAddress])
    expect(store.spendableUtxos).toEqual(walletCoins)
  })
})

describe('a frozen address and the addresses the wallet sends to itself', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  // an HD wallet whose receive address 0 is used and every other address unused; the library's
  // own picks know nothing of the freeze and take the first unused address
  async function storeWithHdWallet() {
    const addressAt = (branch: number, index: number) => `bitcoincash:q${branch}x${index}`
    // the store's HDWallet is the mocked class, which a static import here would not be
    const { HDWallet } = await import('@cashonize/bch-wallet-lib')
    const hdWallet = Object.assign(Object.create(HDWallet.prototype) as object, {
      ...createMockWallet(),
      rawHistory: new Map([[0, [[{}]]], [1, []]]),
      walletCache: { getByIndex: (index: number, branch: number) => ({ address: addressAt(branch, index) }) },
      getDepositAddress: (index = 1) => addressAt(0, index),
      getTokenDepositAddress: (index = 1) => addressAt(0, index) + '-token',
      getAddressByBranch: (branch: number, index: number) => addressAt(branch, index),
    })
    const store = useStore()
    await store.setWallet(hdWallet as never)
    store.walletUtxos = []
    return { store, addressAt }
  }

  it('hands out and sends to itself at the next address once the current one is frozen', async () => {
    const { store, addressAt } = await storeWithHdWallet()
    expect(store.currentDepositAddress).toBe(addressAt(0, 1))

    await store.freezeAddress(addressAt(0, 1))

    expect(store.currentDepositAddress).toBe(addressAt(0, 2))
    expect(store.walletAddresses()).toEqual({ bch: addressAt(0, 2), token: addressAt(0, 2) + '-token' })
  })

  // a payment beyond the discovery window would never be found by a seed restore
  it('refuses to freeze the last fresh receive address of the discovery window', async () => {
    const { store, addressAt } = await storeWithHdWallet()
    for (let index = 1; index < 20; index++) {
      expect(await store.freezeAddress(addressAt(0, index))).toBe(true)
    }

    expect(await store.freezeAddress(addressAt(0, 20))).toBe(false)
    expect(store.frozenAddresses).not.toContain(addressAt(0, 20))
    expect(store.currentDepositAddress).toBe(addressAt(0, 20))
  })
})
