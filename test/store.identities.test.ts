import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Utxo } from 'mainnet-js'
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'
import { useIdentitiesStore } from '../src/stores/identitiesStore'
import { authGuardLockingBytecodes } from '../src/utils/tools/authGuard'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'
import { historyItem, opReturnOutput, p2pkhOutput, tokenOutput, spendOf } from './mocks/history.mocks'

const categoryA = '0123456789abcdef'.repeat(4)
const categoryB = 'fedcba9876543210'.repeat(4)
const authheadA = '00112233445566778899aabbccddeeff'.repeat(2)
const authheadB = 'ffeeddccbbaa99887766554433221100'.repeat(2)
const movedAuthheadA = 'aabb'.repeat(16)

function createMockWallet() {
  return {
    ...mockMainnetWallet,
    networkPrefix: 'bitcoincash',
    getUtxos: vi.fn().mockResolvedValue([]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
  }
}

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

// A registry naming the given authbases, hosted at one HTTPS location: the BCMR output that
// commits to it by hash, and a fetch serving the file, or other bytes, at that location while
// every other request keeps going to the Chaingraph stub in place
function publishedRegistry(identities: Record<string, object>) {
  const content = JSON.stringify({ identities })
  const hash = binToHex(sha256.hash(utf8ToBin(content)))
  const uri = 'registry.example'
  const uriHex = binToHex(utf8ToBin(uri))
  const registryHex = `6a0442434d5220${hash}${(uriHex.length / 2).toString(16).padStart(2, '0')}${uriHex}`
  const serveRegistry = (served = content) => {
    const chaingraphFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (!url.includes(uri)) return chaingraphFetch(url, options)
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(utf8ToBin(served).buffer) })
    }))
  }
  return { registryHex, serveRegistry }
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

// A genesis these keys made as the history carries it: the transaction whose vout-0 outpoint
// became the category, and the genesis spending it, carrying the token
const genesisHistory = (category: string, authhead: string) => [
  historyItem(category, [p2pkhOutput()]),
  historyItem(authhead, [tokenOutput(category, { amount: 1000n })], [spendOf(category, 0)]),
]

// An AuthKey is an NFT with nothing on it: no name, no value, no capability. What makes it a key
// is the covenant its category derives, which the identity output's locking bytecode is compared
// with. Its category is its own: the standard's genesis setup spends two authbases, the
// identity's and the key's, so the key never shares the identity's category.
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

// Three readers want the wallet's full history, and a first open is the one time that costs a
// fetch per transaction, so the store loads it once and hands every reader the same result
describe('the full history for its readers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  const item = historyItem(authheadA, [p2pkhOutput()])
  function startHistoryStore(getHistory: ReturnType<typeof vi.fn>) {
    const store = useStore()
    store.setWallet({ ...createMockWallet(), getHistory } as never)
    return store
  }

  it('hands out the history on hand when it is complete', async () => {
    const getHistory = vi.fn().mockResolvedValue([])
    const store = startHistoryStore(getHistory)
    store.walletHistory = [item]
    store.isHistoryPartial = false

    expect(await store.fullWalletHistory()).toEqual([item])
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('loads the full history once for readers asking together', async () => {
    const getHistory = vi.fn().mockResolvedValue([item])
    const store = startHistoryStore(getHistory)

    const [first, second] = await Promise.all([store.fullWalletHistory(), store.fullWalletHistory()])

    expect(first).toEqual([item])
    expect(second).toEqual([item])
    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getHistory).toHaveBeenCalledWith({ count: -1 })
  })

  it('loads the rest when only the capped history is on hand', async () => {
    const getHistory = vi.fn().mockResolvedValue([item])
    const store = startHistoryStore(getHistory)
    store.walletHistory = [item]
    store.isHistoryPartial = true

    await store.fullWalletHistory()

    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(store.isHistoryPartial).toBe(false)
  })

  it('fails a reader when the history cannot be loaded', async () => {
    const getHistory = vi.fn().mockRejectedValue(new Error('electrum down'))
    const store = startHistoryStore(getHistory)

    await expect(store.fullWalletHistory()).rejects.toThrow()
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
  it('reports an identity found through a key the way detection reports one', async () => {
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

  // With following off, a held NFT of a Studio AuthKey's shape still has its category resolved,
  // so an AuthKey handed to this wallet is recognised and held back whatever the setting says.
  // This chain is guarded by its own category, so that category is the identity and stays listed.
  it('resolves the categories of held key-shaped NFTs when following is off', async () => {
    stubAuthheadQueries(
      { [categoryA]: authheadA, [categoryB]: authheadB },
      { [categoryA]: guardedOutput(categoryA, categoryA, '0') },
    )
    const key = authKeyUtxo(categoryA)
    const collectible: Utxo = {
      txid: 'dd'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
      token: { category: categoryB, amount: 0n, nft: { commitment: 'ab', capability: 'none' } },
    }
    const { store, identitiesStore } = startStore([key, collectible])
    store.tokenList = [{ category: categoryA, amount: 0n }, { category: categoryB, amount: 0n }]
    const asked: string[] = []
    const answer = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      asked.push(options.body as string)
      return answer(url, options)
    }))

    await identitiesStore.followTokenIdentities('keys')

    expect(asked.join()).toContain(categoryA)
    expect(asked.join()).not.toContain(categoryB)
    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], sources: { [categoryA]: 'key' } })
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

  // a pass asked for while one runs waits its turn rather than being dropped: the add and the
  // page's own operations resolve however long the follow tier's lookups take
  it('runs a resolve asked for during a follow pass, after it', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA])
    const { store, identitiesStore } = startStore([utxo(authheadA, 0)])
    store.tokenList = [{ category: categoryB, amount: 100n }]
    const answer = globalThis.fetch
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      calls += 1
      if (calls === 1) await gate
      return answer(url, options)
    }))

    const following = identitiesStore.followTokenIdentities('all')
    const refreshing = identitiesStore.refreshIdentities()
    expect(identitiesStore.identities).toBeUndefined()
    release()
    await Promise.all([following, refreshing])

    expect(identitiesStore.identities?.map(identity => identity.category)).toEqual([categoryA])
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryB])
  })

  // the confirm is read from a resolve of that one identity, so the add shows the card at once,
  // holds its coin back, and keeps the card while a pass that started before it finishes without it
  it('shows an added identity at once, through a pass that started before it', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA])
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([utxo(authheadA, 0), authUtxoB])
    const answer = globalThis.fetch
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      // the pass for the listed identity hangs; the add's own lookup answers at once
      if ((options.body as string).includes(categoryA)) await gate
      return answer(url, options)
    }))
    const refreshing = identitiesStore.refreshIdentities()

    const found = await identitiesStore.inspectCategory(categoryB)
    await identitiesStore.addIdentity(categoryB, found)

    expect(identitiesStore.identities?.map(identity => identity.category)).toEqual([categoryB])
    expect(identitiesStore.identities?.[0]?.status).toBe('held')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]).toBe('auth')
    release()
    await refreshing
    expect(identitiesStore.identities?.map(identity => identity.category)).toEqual([categoryA, categoryB])
  })

  // the wallet's history is read at open; it failing to load must land on the identities
  // page, not flag a wallet that did load
  it('reports a failed lookup at open on the page rather than as a failed wallet', async () => {
    const { store, identitiesStore } = startStore([utxo('cd'.repeat(32), 0)])
    vi.spyOn(store, 'fullWalletHistory').mockRejectedValue(new Error('history refused'))

    await identitiesStore.runChecksOnOpen()

    expect(identitiesStore.openCheckError).toBe('history refused')
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

  // The bug a Studio AuthKey holder met: the key's own category was listed as the identity, so the
  // card had no name and read the guarded token's reserve as its own. The key's chain ends at the
  // identity's authhead, and the token on that output is the identity.
  it("lists the identity an AuthKey guards, not the key's own category", async () => {
    const keyCategory = '1122334455667788'.repeat(4)
    stubAuthheadQueries(
      { [keyCategory]: authheadA, [categoryA]: authheadA },
      {
        [keyCategory]: guardedOutput(keyCategory, categoryA, '500'),
        [categoryA]: guardedOutput(keyCategory, categoryA, '500'),
      },
      { [keyCategory]: guardGenesis(keyCategory, '00') },
    )
    const key = authKeyUtxo(keyCategory)
    const { store, identitiesStore } = startStore([key])
    store.tokenList = [{ category: keyCategory, amount: 0n }]

    await identitiesStore.followTokenIdentities('keys')

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.identities?.map(identity => [identity.category, identity.status, identity.guardedBy]))
      .toEqual([[categoryA, 'heldViaKey', keyCategory]])
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], sources: { [categoryA]: 'key' } })
  })

  // With following on, the same AuthKey arrives in the ordinary batch rather than the keys one and
  // has to be read the same way, or the dialog announces the key's own category as the find.
  it('reads an AuthKey the same way when following every held token', async () => {
    const keyCategory = '1122334455667788'.repeat(4)
    stubAuthheadQueries(
      { [keyCategory]: authheadA, [categoryA]: authheadA },
      {
        [keyCategory]: guardedOutput(keyCategory, categoryA, '500'),
        [categoryA]: guardedOutput(keyCategory, categoryA, '500'),
      },
      { [keyCategory]: guardGenesis(keyCategory, '00') },
    )
    const key = authKeyUtxo(keyCategory)
    const { store, identitiesStore } = startStore([key])
    store.tokenList = [{ category: keyCategory, amount: 0n }]

    await identitiesStore.followTokenIdentities('open')

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], sources: { [categoryA]: 'key' } })
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
  })

  // A key this wallet holds derives the covenant its identity sits in, so a guarded identity is
  // recognised whether or not anything names the key: the registry's authNft is a cross-check.
  it('recognises a guard from a held key the registry does not name', async () => {
    const keyCategory = '1122334455667788'.repeat(4)
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput(keyCategory, categoryA, '500') })
    listIdentities([categoryA])
    const key = authKeyUtxo(keyCategory)
    const { store, identitiesStore } = startStore([key])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.identities?.[0]?.guardedBy).toBe(keyCategory)
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
  })

  // What an earlier version wrote to the list: the key's category. The resolve corrects it in
  // place, so the wallet that carries one is not left with an unnamed card for good.
  it('corrects a listed AuthKey category to the identity it guards', async () => {
    const keyCategory = '1122334455667788'.repeat(4)
    stubAuthheadQueries(
      { [keyCategory]: authheadA, [categoryA]: authheadA },
      {
        [keyCategory]: guardedOutput(keyCategory, categoryA, '500'),
        [categoryA]: guardedOutput(keyCategory, categoryA, '500'),
      },
      { [keyCategory]: guardGenesis(keyCategory, '00') },
    )
    listIdentities([keyCategory])
    const key = authKeyUtxo(keyCategory)
    const { store, identitiesStore } = startStore([key])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.identities?.map(identity => identity.category)).toEqual([categoryA])
    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(store.reservedUtxos[outpointOf(key)]).toBe('auth')
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

  // the registry is trusted for the key's name only as far as a category goes: anything else there
  // is ignored. Asked of a wallet holding no key, so the registry is the only thing that could name one.
  it('ignores an authNft that is not a category', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: guardedOutput('1122334455667788'.repeat(4), categoryA, '500') })
    listIdentities([categoryA])
    const { store, identitiesStore } = startStore([])
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
    const walk = genesisHistory(categoryA, authheadA)

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
    await identitiesStore.detectWalletIdentities(genesisHistory(categoryB, authheadB))

    expect(identitiesStore.unseenIdentities).toEqual([categoryA, categoryB])
    expect(identitiesStore.unseenIdentities.length).toBe(2)
    expect(identitiesStore.announcement).toEqual({ ids: [categoryB], sources: { [categoryB]: 'made' } })
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
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], sources: { [categoryA]: 'arrived' } })
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
    const walk = genesisHistory(categoryA, authheadA)

    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.identityCategories).toEqual([])
    expect(JSON.parse(localStorageMock.getItem('dismissedIdentities-mainnet-testWallet') ?? '[]')).toEqual([categoryA])
  })

  // A publication on a chain whose identity output carries no token, an identity received by
  // transfer say, names nothing by itself. The registry it commits to names its authbases, and
  // the one resolving to the held coin is the identity: listed, held back and announced.
  it('names a publication on a chain it cannot name by the registry it commits to', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryA]: {} })
    stubAuthheadQueries({ [categoryA]: authheadA })
    serveRegistry()
    const { store, identitiesStore } = startStore([authUtxo])
    const walk = [historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])]

    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    expect(identitiesStore.announcement).toEqual({ ids: [categoryA], sources: { [categoryA]: 'made' } })
    expect(identitiesStore.identityPublicationTxids).toEqual([authheadA])
  })

  // the file is trusted for nothing: an authbase it names whose chain ends elsewhere is not
  // this identity, and a location serving other bytes than the hash names is passed over
  // an identity published here and then moved to another own address, a transfer carrying no
  // publication: the publication's output is spent, the later coin is what the resolve ends at
  it('names a publication whose identity has since moved to another coin this wallet holds', async () => {
    const movedUtxo = utxo(movedAuthheadA, 0)
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryA]: {} })
    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    serveRegistry()
    const { store, identitiesStore } = startStore([movedUtxo])

    await identitiesStore.detectWalletIdentities([historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])])

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(store.reservedUtxos[outpointOf(movedUtxo)]).toBe('auth')
  })

  // once named, the chain is listed and the file is not fetched again: the next open would
  // otherwise reach hosting for every bare publication ever made here
  it('fetches the registry once for a chain it has named', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryA]: {} })
    stubAuthheadQueries({ [categoryA]: authheadA })
    serveRegistry()
    const { identitiesStore } = startStore([authUtxo])
    const walk = [historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])]
    await identitiesStore.detectWalletIdentities(walk)
    const registryFetches = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes('registry.example')).length
    expect(registryFetches()).toBe(1)

    await identitiesStore.detectWalletIdentities(walk)

    expect(registryFetches()).toBe(1)
    expect(identitiesStore.identityCategories).toEqual([categoryA])
  })

  // with no coin at output 0 nothing can match, so hosting is not reached at all
  it('fetches no registry when the wallet holds no coin at output 0', async () => {
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryA]: {} })
    stubAuthheadQueries({ [categoryA]: authheadA })
    serveRegistry()
    const { identitiesStore } = startStore([utxo(authheadA, 1)])

    await identitiesStore.detectWalletIdentities([historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])])

    const registryFetches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes('registry.example'))
    expect(registryFetches).toHaveLength(0)
  })

  // a registry can name many identities, each a forward resolve; only so many are asked per file
  it('resolves no more than twenty of the authbases a registry names', async () => {
    const others = Array.from({ length: 30 }, (_, index) => index.toString(16).padStart(64, '0'))
    const { registryHex, serveRegistry } = publishedRegistry(Object.fromEntries(others.map(authbase => [authbase, {}])))
    stubAuthheadQueries({ [others[0]!]: authheadB })
    serveRegistry()
    const { identitiesStore } = startStore([utxo(authheadA, 0)])

    await identitiesStore.detectWalletIdentities([historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])])

    const askedChaingraph = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => !String(url).includes('registry.example'))
      .map(([, options]) => (JSON.parse((options as RequestInit).body as string) as { variables: { hashes?: string[] } }).variables.hashes ?? [])
    expect(askedChaingraph.flat()).toHaveLength(20)
  })

  it('lists nothing when the registry names no chain ending at this coin', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryB]: {} })
    stubAuthheadQueries({ [categoryB]: authheadB })
    serveRegistry()
    const { store, identitiesStore } = startStore([authUtxo])

    await identitiesStore.detectWalletIdentities([historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])])

    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.announcement).toBeUndefined()
    expect(store.spendableUtxos).toEqual([authUtxo])
  })

  it('lists nothing when no location serves the bytes the publication names', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { registryHex, serveRegistry } = publishedRegistry({ [categoryA]: {} })
    stubAuthheadQueries({ [categoryA]: authheadA })
    serveRegistry('{"identities":{}}')
    const { identitiesStore } = startStore([authUtxo])

    await identitiesStore.detectWalletIdentities([historyItem(authheadA, [p2pkhOutput(), opReturnOutput(registryHex)])])

    expect(identitiesStore.identityCategories).toEqual([])
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
