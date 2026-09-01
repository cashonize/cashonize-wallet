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
  }
}

const categoryA = '0123456789abcdef'.repeat(4)
const categoryB = 'fedcba9876543210'.repeat(4)
const authheadA = '00112233445566778899aabbccddeeff'.repeat(2)
const authheadB = 'ffeeddccbbaa99887766554433221100'.repeat(2)
const movedAuthheadA = 'aabb'.repeat(16)

const utxo = (txid: string, vout: number, token?: Utxo['token']): Utxo =>
  ({ txid, vout, satoshis: 1000n, address: 'bitcoincash:qtest', ...(token ? { token } : {}) })

// Answers the authhead query for every mapped category and rejects for any other, the way an
// unreachable server would, which is what puts an identity in the 'unresolved' state
function stubAuthheadQueries(authheads: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const query = (JSON.parse(options.body as string) as { query: string }).query
    const category = Object.keys(authheads).find(listed => query.includes(listed))
    if (!category) return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: { transaction: [{ authchains: [{ authhead: {
          hash: `\\x${authheads[category]}`, // chaingraph returns bytea as \x-prefixed hex
          identity_output: [{ fungible_token_amount: '0' }],
          outputs: [],
        } }] }] },
      }),
    })
  }))
}

// The identities the store loads for a wallet come from storage, so they are written before the
// wallet is set, the way a returning session has them
function listIdentities(categories: string[]) {
  localStorageMock.setItem('identities-mainnet-testWallet', JSON.stringify(categories))
}

function startStore(walletUtxos: Utxo[]) {
  const store = useStore()
  store.setWallet(createMockWallet() as never)
  store.walletUtxos = walletUtxos
  return store
}

describe('auth reservations follow the authchain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // no unstubAllGlobals here: the mocks module stubs localStorage once, at import
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  it('reserves the authhead of a listed identity the wallet holds', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const store = startStore([authUtxo])

    await store.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // the authhead moves to a new outpoint whenever the metadata is updated elsewhere
  it('moves the reservation when the authhead moved to another coin', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const oldAuthUtxo = utxo(authheadA, 0)
    const newAuthUtxo = utxo(movedAuthheadA, 0)
    const store = startStore([oldAuthUtxo, newAuthUtxo])
    await store.refreshIdentities()

    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await store.refreshIdentities()

    expect(outpointOf(oldAuthUtxo) in store.reservedUtxos).toBe(false)
    expect(store.reservedUtxos[outpointOf(newAuthUtxo)]?.reason).toBe('auth')
  })

  // a failed query says nothing about where its authhead went, so an outage must leave coins
  // locked rather than releasing them
  it('drops nothing while any identity failed to resolve', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA, categoryB])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const store = startStore([authUtxoA, authUtxoB])
    await store.refreshIdentities()

    // categoryA now answers with a different authhead, categoryB's query fails outright
    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await store.refreshIdentities()

    expect(store.identities?.find(identity => identity.category === categoryB)?.status).toBe('unresolved')
    expect(store.reservedUtxos[outpointOf(authUtxoA)]?.reason).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]?.reason).toBe('auth')
  })

  it('leaves a reservation another feature made alone', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const store = startStore([authUtxo])
    await store.reserveUtxo(authUtxo, 'pledge')

    await store.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('pledge')
  })

  // the scan writes the identity categories and hands the resolving over, so it can never publish
  // a partial list that the drop pass then reads as "these authheads are gone"
  it('keeps a listed identity reserved through a scan that finds another one', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const store = startStore([authUtxoA, authUtxoB])
    await store.refreshIdentities()
    // categoryB is a held token category the list does not cover yet
    store.tokenList = [{ category: categoryB, amount: 100n }]

    const summary = await store.scanForIdentities()

    expect(summary).toEqual({ found: 1, alreadyListed: 0, carriesTokens: 0, failed: 0 })
    expect(store.reservedUtxos[outpointOf(authUtxoA)]?.reason).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]?.reason).toBe('auth')
    expect(store.identityCategories).toEqual([categoryA, categoryB])
  })

  // an authhead carrying a token reserve is protected the same way, now that a reservation binds
  // for a token coin; what it carries has no actions yet, so the card only reports it
  it('holds back an authhead that carries a token reserve', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0, { category: categoryA, amount: 1000n })
    const store = startStore([authUtxo])

    await store.refreshIdentities()

    expect(store.identities?.[0]?.status).toBe('carriesTokens')
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  it('releases the authhead of an identity removed from the list', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const store = startStore([authUtxo])
    await store.refreshIdentities()

    await store.removeIdentity(categoryA)

    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([authUtxo])
  })
})
