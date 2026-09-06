import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Utxo } from 'mainnet-js'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'
import { useIdentitiesStore } from '../src/stores/identitiesStore'
import { authGuardLockingBytecodes } from '../src/utils/tools/authGuard'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'

function createMockWallet() {
  return {
    ...mockMainnetWallet,
    networkPrefix: 'bitcoincash',
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

// Answers the authhead queries, single or batched, for every mapped category, with the identity
// output the chain reports when one is given. A batch none of whose categories is mapped
// rejects, the way an unreachable server would; a mapped batch answers for the categories it
// knows and leaves the rest out, which is that category unresolved on its own
function stubAuthheadQueries(
  authheads: Record<string, string>,
  identityOutputs: Record<string, object> = {},
  genesisOutputs: Record<string, object[]> = {},
) {
  const answer = (category: string) => {
    const output = identityOutputs[category]
    const genesis = genesisOutputs[category]
    return {
      hash: `\\x${category}`,
      // chaingraph returns bytea as \x-prefixed hex
      authchains: [{
        authhead: { hash: `\\x${authheads[category]}`, outputs: output ? [output] : [] },
        genesis: genesis ? [{ transaction: [{ outputs: genesis }] }] : [],
        lastPublication: [],
        recent: [],
      }],
    }
  }
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const { variables } = JSON.parse(options.body as string) as { variables: { hash?: string, hashes?: string[] } }
    const asked = variables.hashes ?? (variables.hash ? [variables.hash] : [])
    const known = Object.keys(authheads).filter(listed => asked.includes(`\\x${listed}`))
    if (!known.length) return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: { transaction: known.map(answer) } }),
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
  const identitiesStore = useIdentitiesStore()
  store.setWallet(createMockWallet() as never)
  store.walletUtxos = walletUtxos
  return { store, identitiesStore }
}

// An AuthKey is an NFT with nothing on it: no name, no value, no capability. What makes it a key
// is the covenant its category derives, which the identity output's locking bytecode is compared
// with. In the standard's genesis setup the key shares the identity's category.
const authKeyUtxo = (category: string): Utxo => ({
  txid: 'ee'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
  token: { category, amount: 0n, nft: { commitment: '00', capability: 'none' } },
})
// the identity output as the chain reports it, sitting in the covenant a key category opens
const guardedOutput = (keyCategory: string, identityCategory: string, reserve: string) => ({
  locking_bytecode: `\\x${authGuardLockingBytecodes(keyCategory).p2sh20}`,
  value_satoshis: '1000',
  token_category: `\\x${identityCategory}`,
  fungible_token_amount: reserve,
  nonfungible_token_capability: null,
  nonfungible_token_commitment: null,
})
// the standard's genesis setup as the chain reports it: the guard at output 0, the key at output 1
const guardGenesis = (category: string, keyCommitment: string) => [
  { output_index: '0', token_category: `\\x${category}`, fungible_token_amount: '1000',
    nonfungible_token_capability: null, nonfungible_token_commitment: null },
  { output_index: '1', token_category: `\\x${category}`, fungible_token_amount: '0',
    nonfungible_token_capability: 'none', nonfungible_token_commitment: `\\x${keyCommitment}` },
]

// The walk is the most expensive query the wallet sends, and two features read it, so the store
// runs it once per state of the wallet and hands both the same result
describe('the spent-outputs walk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  function stubWalk(rows: unknown[] = []) {
    const walk = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { search_output: rows } }) }))
    vi.stubGlobal('fetch', walk)
    return walk
  }
  // the walk is rooted at the wallet's addresses, so the mock has to hold one that decodes
  function startWalkingStore(walletUtxos: Utxo[]) {
    const store = useStore()
    const walletWithAddress = {
      ...createMockWallet(),
      getDepositAddress: () => 'bitcoincash:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue',
    }
    store.setWallet(walletWithAddress as never)
    store.walletUtxos = walletUtxos
    return store
  }

  it('shares one walk between callers while the coins stay the same', async () => {
    const walk = stubWalk()
    const store = startWalkingStore([utxo(authheadA, 0)])

    const [first, second] = await Promise.all([store.walkSpentOutputs(), store.walkSpentOutputs()])
    await store.walkSpentOutputs()

    expect(first).toBe(second)
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('walks again once a coin has moved', async () => {
    const walk = stubWalk()
    const store = startWalkingStore([utxo(authheadA, 0)])
    await store.walkSpentOutputs()

    store.walletUtxos = [utxo(authheadB, 0)]
    await store.walkSpentOutputs()

    expect(walk).toHaveBeenCalledTimes(2)
  })

  // a reader with rows on screen is back for what the indexer caught up on; one still in flight
  // is fresh enough to share
  it('walks again when asked for a fresh one, unless one is still running', async () => {
    const walk = stubWalk()
    const store = startWalkingStore([utxo(authheadA, 0)])
    await Promise.all([store.walkSpentOutputs(), store.walkSpentOutputs(true)])
    expect(walk).toHaveBeenCalledTimes(1)

    await store.walkSpentOutputs(true)
    expect(walk).toHaveBeenCalledTimes(2)
  })

  it('does not keep a walk that failed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const store = startWalkingStore([utxo(authheadA, 0)])
    await expect(store.walkSpentOutputs()).rejects.toThrow()

    const walk = stubWalk()
    await store.walkSpentOutputs()

    expect(walk).toHaveBeenCalledTimes(1)
  })
})

// The notification trail leads to this page for two reasons, and both have to stop asking once
// the page has been opened: the shape of an identity key is a shape ordinary NFTs can have, so a
// standing lamp on a guess would train people to ignore the one the backup warning shares.
describe('the identities notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  // a Studio user's key is a held token like any other, so following the tokens' identities finds
  // what it guards and lists it without being asked; that is worth telling them
  it('reports an identity found through a key the way the walk reports one', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(categoryA, categoryA, '0') })
    const { store, identitiesStore } = startStore([authKeyUtxo(categoryA)])
    store.tokenList = [{ category: categoryA, amount: 0n }]

    await identitiesStore.followTokenIdentities('open')

    expect(identitiesStore.identityCategories).toContain(categoryA)
    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.unseenIdentities).toContain(categoryA)
    expect(identitiesStore.unseenIdentities.length).toBe(1)

    identitiesStore.markIdentitiesSeen()
    expect(identitiesStore.unseenIdentities.length).toBe(0)
  })
})

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
    const { store, identitiesStore } = startStore([authUtxo])

    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // the authhead moves to a new outpoint whenever the metadata is updated elsewhere, which
  // spends the old coin: the reservation follows to the new one and leaves the spent one
  it('moves the reservation when the authhead moved to another coin', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const oldAuthUtxo = utxo(authheadA, 0)
    const newAuthUtxo = utxo(movedAuthheadA, 0)
    const { store, identitiesStore } = startStore([oldAuthUtxo])
    await identitiesStore.refreshIdentities()

    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    store.walletUtxos = [newAuthUtxo]
    await identitiesStore.refreshIdentities()

    expect(outpointOf(oldAuthUtxo) in store.reservedUtxos).toBe(false)
    expect(store.reservedUtxos[outpointOf(newAuthUtxo)]).toBe('auth')
  })

  // Chaingraph can be behind the wallet's own operation and still name the old outpoint: a
  // resolve never releases a coin the wallet holds at output 0, since the chain moves only by
  // spending it
  it('keeps a held coin reserved when the indexer still names the old authhead', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const newAuthUtxo = utxo(movedAuthheadA, 0)
    const { store, identitiesStore } = startStore([newAuthUtxo])
    await store.reserveOutpoints([outpointOf(newAuthUtxo)], 'auth')

    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(newAuthUtxo)]).toBe('auth')
  })

  // a failed query says nothing about where its authhead went, so an outage must leave coins
  // locked rather than releasing them
  it('drops nothing while any identity failed to resolve', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA, categoryB])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    await identitiesStore.refreshIdentities()

    // categoryA now answers with a different authhead, categoryB's query fails outright
    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.find(identity => identity.category === categoryB)?.status).toBe('unresolved')
    expect(store.reservedUtxos[outpointOf(authUtxoA)]).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]).toBe('auth')
  })

  it('leaves a reservation another feature made alone', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    await store.reserveOutpoints([outpointOf(authUtxo)], 'pledge')

    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('pledge')
  })

  // the scan writes the identity categories and hands the resolving over, so it can never publish
  // the identity of a held token whose authhead is here is promoted to the list and held back,
  // and the listed one stays reserved through the pass
  it('promotes a followed token identity whose authhead is here, and announces it', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    await identitiesStore.refreshIdentities()
    // categoryB is a held token category the list does not cover yet
    store.tokenList = [{ category: categoryB, amount: 100n }]

    await identitiesStore.followTokenIdentities('all')

    expect(store.reservedUtxos[outpointOf(authUtxoA)]).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]).toBe('auth')
    expect(identitiesStore.identityCategories).toEqual([categoryA, categoryB])
    expect(identitiesStore.unseenIdentities).toEqual([categoryB])
    expect(identitiesStore.announcement?.ids).toEqual([categoryB])
    expect(identitiesStore.tokenIdentities).toEqual([])
  })

  // an outage at open lands on the page, and lists nothing: "not held" from a server that did
  // not answer would be a wrong answer, not a missing one
  it('reports an outage from the follow at open and lists nothing', async () => {
    stubAuthheadQueries({})
    const { store, identitiesStore } = startStore([utxo(authheadB, 0)])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryB, amount: 100n }]

    await identitiesStore.followTokenIdentities('open')

    expect(identitiesStore.openCheckError).toEqual(expect.any(String))
    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.tokenIdentities).toEqual([])
  })

  // a followed identity held elsewhere is neither listed nor news, and a category the server
  // does not know is left out of the group rather than shown as an answer
  it('follows the identity of a held token without listing it', async () => {
    stubAuthheadQueries({ [categoryB]: authheadB })
    const { store, identitiesStore } = startStore([utxo('cafe'.repeat(16), 0)])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryA, amount: 5n }, { category: categoryB, amount: 100n }]

    await identitiesStore.followTokenIdentities('all')

    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.unseenIdentities).toEqual([])
    expect(identitiesStore.announcement).toBeUndefined()
    expect(identitiesStore.tokenIdentities?.map(identity => [identity.category, identity.status]))
      .toEqual([[categoryB, 'notHeld']])
    expect(store.reservedUtxos).toEqual({})
  })

  // the open pass asks about every held category, the ones already answered included, since the
  // states are not persisted and a group filled from memory alone would be half empty until the
  // visit; a token sent away leaves the group on the next pass
  it('asks at open about every held category, and drops a token sent away', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    const { store, identitiesStore } = startStore([])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryA, amount: 5n }]
    await identitiesStore.followTokenIdentities('open')
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryA])

    const asked: string[] = []
    const answering = fetch as unknown as { mock: { calls: unknown[][] } }
    const before = answering.mock.calls.length
    store.tokenList = [{ category: categoryA, amount: 5n }, { category: categoryB, amount: 1n }]
    await identitiesStore.followTokenIdentities('open')
    for (const call of answering.mock.calls.slice(before)) {
      const { variables } = JSON.parse((call[1] as RequestInit).body as string) as { variables: { hashes?: string[] } }
      asked.push(...(variables.hashes ?? []))
    }
    expect(asked).toEqual([`\\x${categoryA}`, `\\x${categoryB}`])
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryA, categoryB])

    store.tokenList = [{ category: categoryB, amount: 1n }]
    await identitiesStore.followTokenIdentities('all')
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryB])
  })

  // the reservation writes go under whichever wallet is active when they run, so a pass writes
  // nothing once the wallet switched during its lookup, and writes all of them in one go otherwise,
  // ahead of the refresh a switch could land in
  it('writes a pass\'s reservations together, or not at all once the wallet switched', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA, categoryB])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    const reservedKey = 'reservedUtxos-mainnet-testWallet'
    const written = () => Object.keys(JSON.parse(localStorageMock.getItem(reservedKey) ?? '{}') as Record<string, unknown>)

    // the switch lands during the lookup: nothing is written
    const answering = fetch as unknown as { getMockImplementation: () => (...args: unknown[]) => unknown, mockImplementationOnce: (fn: (...args: unknown[]) => unknown) => void }
    const answer = answering.getMockImplementation()
    answering.mockImplementationOnce(async (...args: unknown[]) => {
      await store.resetWalletState({ resetDappConnections: false })
      return answer(...args)
    })
    await identitiesStore.refreshIdentities()
    expect(written()).toEqual([])

    // the switch lands during the refresh after the writes: both are already under this wallet's key
    const again = startStore([authUtxoA, authUtxoB])
    again.store.wallet.getMaxAmountToSend = vi.fn()
      .mockImplementationOnce(async () => {
        await again.store.resetWalletState({ resetDappConnections: false })
        return 0n
      })
      .mockResolvedValue(0n)
    await again.identitiesStore.refreshIdentities()
    expect(written()).toEqual([outpointOf(authUtxoA), outpointOf(authUtxoB)])
  })

  // the wallet's history is walked at open; the server refusing must land on the identities
  // page, not flag a wallet that did load
  it('reports a failed lookup at open on the page rather than as a failed wallet', async () => {
    const { store, identitiesStore } = startStore([utxo('cd'.repeat(32), 0)])
    vi.spyOn(store, 'walkSpentOutputs').mockRejectedValue(new Error('chaingraph refused'))

    await identitiesStore.runChecksOnOpen()

    expect(identitiesStore.openCheckError).toBe('chaingraph refused')
    expect(identitiesStore.identityCategories).toEqual([])
    expect(store.walletInitFailed).toBe(false)
  })

  // a followed identity whose authhead arrives later is promoted on the next pass, held back and
  // announced, the same as one found at open
  it('promotes a followed identity when its authhead arrives', async () => {
    stubAuthheadQueries({ [categoryB]: authheadB })
    const { store, identitiesStore } = startStore([])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryB, amount: 100n }]
    await identitiesStore.followTokenIdentities('all')
    expect(identitiesStore.identityCategories).toEqual([])

    const authUtxoB = utxo(authheadB, 0)
    store.walletUtxos = [authUtxoB]
    await identitiesStore.followTokenIdentities('all')

    expect(identitiesStore.identityCategories).toEqual([categoryB])
    expect(identitiesStore.unseenIdentities).toEqual([categoryB])
    expect(identitiesStore.announcement?.ids).toEqual([categoryB])
    expect(store.reservedUtxos[outpointOf(authUtxoB)]).toBe('auth')
    expect(identitiesStore.openCheckError).toBeUndefined()
  })

  // an authhead carrying a token reserve is protected the same way, now that a reservation binds
  // for a token coin; what it carries has no actions yet, so the card only reports it
  it('holds back an authhead that carries a token reserve', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0, { category: categoryA, amount: 1000n })
    const { store, identitiesStore } = startStore([authUtxo])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('held')
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // the AuthGuard standard: the identity output lives in a covenant, and the wallet holds the key
  // that opens it. Authority over the identity without the coin.
  it('finds an identity its AuthKey guards, and reserves the key', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(categoryA, categoryA, '500') })
    listIdentities([categoryA])
    const key = authKeyUtxo(categoryA)
    const { store, identitiesStore } = startStore([key])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.identities?.[0]?.guardedBy).toBe(categoryA)
    // what the guard holds is read off the chain, since the coin is not here
    expect(identitiesStore.identities?.[0]?.identityOutput?.token?.amount).toBe(500n)
    // the key carries the authority, so the key is what gets held back
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // an identity that adopted a guard after its genesis has a key of another category, which the
  // registry names; the wallet reads the name off the indexer's copy
  it('finds the key an adopted guard is named with in the registry', async () => {
    const keyCategory = '1122334455667788'.repeat(4)
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(keyCategory, categoryA, '500') })
    listIdentities([categoryA])
    const key = authKeyUtxo(keyCategory)
    const { store, identitiesStore } = startStore([key])
    store.bcmrRegistries = {
      [categoryA]: { name: 'Named', description: '', token: { category: categoryA, symbol: 'NMD' }, extensions: { authNft: keyCategory } },
    }

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.identities?.[0]?.guardedBy).toBe(keyCategory)
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
  })

  // the guard is somebody else's to open: the identity is watched, and the NFT of the identity's
  // category this wallet holds is an ordinary NFT
  it('does not take an NFT for a key when the identity sits in another key\'s guard', async () => {
    const otherKey = '1122334455667788'.repeat(4)
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(otherKey, categoryA, '500') })
    listIdentities([categoryA])
    const lookalike = authKeyUtxo(categoryA)
    const { store, identitiesStore } = startStore([lookalike])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(identitiesStore.identities?.[0]?.guardedBy).toBeUndefined()
    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([lookalike])
  })

  // a collection guarded by its own category shares that category with every NFT in it; the
  // genesis says which commitment the key was minted with, and only that one is the key
  it('takes only the NFT the genesis minted as the key of an identity guarded by its own category', async () => {
    const stub = () => stubAuthheadQueries(
      { [categoryA]: authheadA },
      { [categoryA]: guardedOutput(categoryA, categoryA, '500') },
      { [categoryA]: guardGenesis(categoryA, '00') },
    )
    listIdentities([categoryA])
    const collectionNft: Utxo = { ...authKeyUtxo(categoryA), token: { category: categoryA, amount: 0n, nft: { commitment: 'ab', capability: 'none' } } }

    stub()
    const { store, identitiesStore } = startStore([collectionNft])
    await identitiesStore.refreshIdentities()
    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos).toEqual({})

    stub()
    const key = authKeyUtxo(categoryA)
    store.walletUtxos = [collectionNft, key]
    await identitiesStore.refreshIdentities()
    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.identities?.[0]?.keyUtxo).toEqual(key)
    expect(store.reservedUtxos).toEqual({ [outpointOf(key)]: 'auth' })
  })

  // an NFT with a capability is not what the covenant takes at input 1, whatever its category
  it('does not take a capability-bearing NFT of the key category for the key', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(categoryA, categoryA, '500') })
    listIdentities([categoryA])
    const minting: Utxo = { ...authKeyUtxo(categoryA), token: { category: categoryA, amount: 0n, nft: { commitment: '00', capability: 'minting' } } }
    const { store, identitiesStore } = startStore([minting])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos).toEqual({})
  })

  // the registry is trusted for the key's name only as far as a category goes: anything else there is ignored
  it('ignores an authNft that is not a category', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput('1122334455667788'.repeat(4), categoryA, '500') })
    listIdentities([categoryA])
    const { store, identitiesStore } = startStore([authKeyUtxo('1122334455667788'.repeat(4))])
    store.bcmrRegistries = {
      [categoryA]: { name: 'Named', description: '', token: { category: categoryA, symbol: 'NMD' }, extensions: { authNft: 'not a category' } },
    }

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos).toEqual({})
  })

  // The wallet's own view can trail the transaction it just made: the created identity's coin is
  // reserved before any coin list shows it, and the resolve that follows must not take it back
  it('keeps a created identity\'s reservation while the wallet has not seen the coin yet', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    const { store, identitiesStore } = startStore([])

    await identitiesStore.listCreatedIdentity(categoryA, authheadA)

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos[`${authheadA}:0`]).toBe('auth')
  })

  // the card that could transfer the key goes with the identity, so the key cannot stay frozen
  it('releases the key when the identity it opens is removed', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(categoryA, categoryA, '500') })
    listIdentities([categoryA])
    const key = authKeyUtxo(categoryA)
    const { store, identitiesStore } = startStore([key])
    await identitiesStore.refreshIdentities()
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')

    await identitiesStore.removeIdentity(categoryA)

    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([key])
  })

  // an identity output at an ordinary address is not guarded, whatever NFTs of its category sit here
  it('leaves an NFT of an unguarded identity\'s category alone', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const nft = authKeyUtxo(categoryA)
    const { store, identitiesStore } = startStore([nft])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([nft])
  })

  // The wallet lists this one itself: these keys made it, and its authhead is sitting here as an
  // anonymous coin that an ordinary send would spend.
  it('lists and holds back an authhead these keys genesised', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    const walk = [{
      transaction_hash: `\\x${categoryA}`,
      output_index: '0',
      spent_by: [{ transaction: { hash: `\\x${authheadA}`, outputs: [
        { output_index: '0', locking_bytecode: '\\x76a914', token_category: `\\x${categoryA}`,
          nonfungible_token_commitment: null, fungible_token_amount: '1000', spent_by: [] },
      ] } }],
    }]

    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    // and it says so, rather than the coin quietly becoming unspendable: a dialog the first time
    expect(identitiesStore.unseenIdentities).toEqual([categoryA])
    expect(identitiesStore.announcement?.ids).toEqual([categoryA])
    // the wallet page opens the dialog and clears the announcement
    identitiesStore.announcement = undefined

    // a later find is told the same way: every coin the wallet holds back unasked is news
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    const authUtxoB = utxo(authheadB, 0)
    store.walletUtxos = [authUtxo, authUtxoB]
    await identitiesStore.detectWalletIdentities([{
      transaction_hash: `\\x${categoryB}`,
      output_index: '0',
      spent_by: [{ transaction: { hash: `\\x${authheadB}`, outputs: [
        { output_index: '0', locking_bytecode: '\\x76a914', token_category: `\\x${categoryB}`,
          nonfungible_token_commitment: null, fungible_token_amount: '1000', spent_by: [] },
      ] } }],
    }])

    expect(identitiesStore.unseenIdentities).toEqual([categoryA, categoryB])
    expect(identitiesStore.unseenIdentities.length).toBe(2)
    expect(identitiesStore.announcement).toEqual({ ids: [categoryB], arrived: [] })
  })

  // The authhead of a watched identity usually arrives while the app is closed, so the resolve
  // judges an arrival against what was watched at the last complete resolve, whichever session
  // that was, and tells it as an arrival rather than a find
  it('tells a watched identity that arrived while the app was closed as an arrival', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const { store, identitiesStore } = startStore([])
    await identitiesStore.refreshIdentities()
    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(JSON.parse(localStorageMock.getItem('watchedIdentities-mainnet-testWallet') ?? '[]')).toEqual([categoryA])
    expect(identitiesStore.announcement).toBeUndefined()

    // the app restarts with the authhead in the wallet
    const authUtxo = utxo(authheadA, 0)
    store.walletUtxos = [authUtxo]
    identitiesStore.loadForWallet('mainnet', 'testWallet')
    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], arrived: [categoryA] })
    expect(JSON.parse(localStorageMock.getItem('watchedIdentities-mainnet-testWallet') ?? '[]')).toEqual([])
    // held now, so not an arrival again on the next resolve
    identitiesStore.announcement = undefined
    await identitiesStore.refreshIdentities()
    expect(identitiesStore.announcement).toBeUndefined()
  })

  // an incomplete resolve says nothing about where anything is, so it must not turn a watched
  // identity into an unwatched one that will never be told when it arrives
  it('keeps what was watched through a resolve that could not reach the server', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const { identitiesStore } = startStore([])
    await identitiesStore.refreshIdentities()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('unresolved')
    expect(JSON.parse(localStorageMock.getItem('watchedIdentities-mainnet-testWallet') ?? '[]')).toEqual([categoryA])
  })

  // removing is a decision the automatic detection has to respect, or it is refought every open
  it('does not list again what the user removed', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const { identitiesStore } = startStore([authUtxo])
    await identitiesStore.refreshIdentities()
    await identitiesStore.removeIdentity(categoryA)
    const walk = [{
      transaction_hash: `\\x${categoryA}`,
      output_index: '0',
      spent_by: [{ transaction: { hash: `\\x${authheadA}`, outputs: [
        { output_index: '0', locking_bytecode: '\\x76a914', token_category: `\\x${categoryA}`,
          nonfungible_token_commitment: null, fungible_token_amount: '1000', spent_by: [] },
      ] } }],
    }]

    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.identityCategories).toEqual([])
    expect(JSON.parse(localStorageMock.getItem('dismissedIdentities-mainnet-testWallet') ?? '[]')).toEqual([categoryA])
  })

  // A publication on a chain with no token names nothing, so nothing is listed, held back or
  // announced for it: a non-token identity is listed by the user adding its authbase. The
  // publication still counts for the history's label.
  it('lists nothing for a publication on a chain it cannot name', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    const walk = [{
      transaction_hash: `\\x${categoryA}`,
      output_index: '1',
      spent_by: [{ transaction: { hash: `\\x${authheadA}`, outputs: [
        { output_index: '0', locking_bytecode: '\\x76a914', token_category: null,
          nonfungible_token_commitment: null, fungible_token_amount: null, spent_by: [] },
        { output_index: '1', locking_bytecode: '\\x6a0442434d52201111111111111111111111111111111111111111111111111111111111111111', token_category: null,
          nonfungible_token_commitment: null, fungible_token_amount: null, spent_by: [] },
      ] } }],
    }]

    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.unseenIdentities).toEqual([])
    expect(identitiesStore.announcement).toBeUndefined()
    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([authUtxo])
    expect(identitiesStore.identityPublicationTxids).toEqual([authheadA])
  })

  // the checks are read by position in the publication's locations, so they answer for that
  // publication only: after a publish with new locations, last visit's badges would land on them
  it('drops the publication checks once the publication changed, and keeps them while it has not', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA, categoryB])
    const { identitiesStore } = startStore([utxo(authheadA, 0), utxo(authheadB, 0)])
    await identitiesStore.refreshIdentities()
    // the stub answers with no publication, so A's earlier publication is the one that changed
    identitiesStore.identities = identitiesStore.identities!.map(identity =>
      identity.category === categoryA ? { ...identity, publication: { hash: 'ab'.repeat(32), uris: ['old.example'] } } : identity
    )
    identitiesStore.publicationChecks = { [categoryA]: ['changed'], [categoryB]: ['verified'] }

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.publicationChecks).toEqual({ [categoryB]: ['verified'] })
  })

  // the identities page lists a picked UTXO the way the create page lists a genesis: held back
  // straight away, before any lookup catches up
  it('lists an identity added from a held UTXO and holds it back', async () => {
    const txid = 'cafe'.repeat(16)
    stubAuthheadQueries({ [txid]: txid })
    const picked = utxo(txid, 0)
    const { store, identitiesStore } = startStore([picked])

    await identitiesStore.listCreatedIdentity(txid, txid)

    expect(identitiesStore.identityCategories).toContain(txid)
    expect(store.reservedUtxos[outpointOf(picked)]).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  it('releases the authhead of an identity removed from the list', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    await identitiesStore.refreshIdentities()

    await identitiesStore.removeIdentity(categoryA)

    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([authUtxo])
  })
})
