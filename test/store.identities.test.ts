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
function stubAuthheadQueries(authheads: Record<string, string>, identityOutputs: Record<string, object> = {}) {
  const answer = (category: string) => {
    const output = identityOutputs[category]
    return {
      hash: `\\x${category}`,
      // chaingraph returns bytea as \x-prefixed hex
      authchains: [{
        authhead: { hash: `\\x${authheads[category]}`, outputs: output ? [output] : [] },
        genesis: [], lastPublication: [], recent: [],
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

// Chaingraph and a registry host in one stub: a chain's authhead, with the publication its authhead
// carries when it has one, and the file a location serves. Naming is forward at every step, so the
// test's chains say where each authbase ends and the registry says which authbases to try.
function stubIdentityServers(
  chains: Record<string, { authhead: string, publication?: string }>,
  registries: Record<string, string> = {},
  onQuery?: (hash: string) => void,
) {
  vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => {
    // the Chaingraph setting is empty in tests, so the url is matched as a string, not assumed one
    const registry = Object.entries(registries).find(([prefix]) => String(url ?? '').startsWith(prefix))
    if (registry) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(utf8ToBin(registry[1]).buffer) })
    // one category asked at a time here, through the batch query
    const { variables } = JSON.parse(options?.body as string) as { variables: { hashes?: string[] } }
    const hash = variables.hashes?.[0]?.slice(2) ?? ''
    onQuery?.(hash)
    const chain = chains[hash]
    if (!chain) return Promise.reject(new TypeError('Failed to fetch'))
    const lastPublication = chain.publication
      ? [{ transaction: [{ outputs: [{ locking_bytecode: `\\x${chain.publication}` }] }] }]
      : []
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: { transaction: [{ hash: `\\x${hash}`, authchains: [{
          authhead: { hash: `\\x${chain.authhead}`, outputs: [] },
          genesis: [],
          lastPublication,
          recent: [{ transaction: [{ hash: `\\x${chain.authhead}` }] }],
        }] }] },
      }),
    })
  }))
}

// a registry naming one identity, and the publication output committing to it, hosted at example.com
const registryNaming = (category: string) =>
  JSON.stringify({ identities: { [category]: { '2024-01-01T00:00:00.000Z': { name: 'Named' } } } })
const publicationOf = (content: string) =>
  `6a0442434d5220${binToHex(sha256.hash(utf8ToBin(content)))}0b${binToHex(utf8ToBin('example.com'))}`

// a spent-outputs row for a publication these keys made on a chain that carries no token
const publicationRow = (authhead: string) => ({
  transaction_hash: `\\x${'ff'.repeat(32)}`,
  output_index: '1',
  spent_by: [{ transaction: { hash: `\\x${authhead}`, outputs: [
    { output_index: '0', locking_bytecode: '\\x76a914', token_category: null,
      nonfungible_token_commitment: null, fungible_token_amount: null, spent_by: [] },
    { output_index: '1', locking_bytecode: `\\x${'6a0442434d5220' + '11'.repeat(32)}`, token_category: null,
      nonfungible_token_commitment: null, fungible_token_amount: null, spent_by: [] },
  ] } }],
})

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

    await identitiesStore.followTokenIdentities('new')

    expect(identitiesStore.identityCategories).toContain(categoryA)
    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.unseenIdentities).toContain(categoryA)
    expect(identitiesStore.unseenCount).toBe(1)

    identitiesStore.markIdentitiesSeen()
    expect(identitiesStore.unseenCount).toBe(0)
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
    await store.reserveOutpoint(outpointOf(newAuthUtxo), 'auth')

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
    await store.reserveUtxo(authUtxo, 'pledge')

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
    expect(identitiesStore.announcement).toEqual([categoryB])
    expect(identitiesStore.tokenIdentities).toEqual([])
  })

  // an outage at open lands on the page, and lists nothing: "not held" from a server that did
  // not answer would be a wrong answer, not a missing one
  it('reports an outage from the follow at open and lists nothing', async () => {
    stubAuthheadQueries({})
    const { store, identitiesStore } = startStore([utxo(authheadB, 0)])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryB, amount: 100n }]

    await identitiesStore.followTokenIdentities('new')

    expect(identitiesStore.openCheckError).toEqual(expect.any(String))
    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.tokenIdentities).toEqual([])
    expect(localStorageMock.getItem('followedIdentities-mainnet-testWallet')).toBeNull()
  })

  // a followed identity held elsewhere is neither listed nor news; the memory says it was looked
  // up, and only a fulfilled lookup writes it
  it('follows the identity of a held token without listing it, and remembers only what answered', async () => {
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
    const followed = JSON.parse(localStorageMock.getItem('followedIdentities-mainnet-testWallet') ?? '{}') as Record<string, unknown>
    expect(Object.keys(followed)).toEqual([categoryB])
    expect(store.reservedUtxos).toEqual({})
  })

  // the open pass asks only for categories never looked up, up to its cap; a token sent away
  // leaves the group on the next pass
  it('asks at open only about categories it has not followed, and drops a token sent away', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    const { store, identitiesStore } = startStore([])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryA, amount: 5n }]
    await identitiesStore.followTokenIdentities('new')
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryA])

    const asked: string[] = []
    const answering = fetch as unknown as { mock: { calls: unknown[][] } }
    const before = answering.mock.calls.length
    store.tokenList = [{ category: categoryA, amount: 5n }, { category: categoryB, amount: 1n }]
    await identitiesStore.followTokenIdentities('new')
    for (const call of answering.mock.calls.slice(before)) {
      const { variables } = JSON.parse((call[1] as RequestInit).body as string) as { variables: { hashes?: string[] } }
      asked.push(...(variables.hashes ?? []))
    }
    expect(asked).toEqual([`\\x${categoryB}`])
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryA, categoryB])

    store.tokenList = [{ category: categoryB, amount: 1n }]
    await identitiesStore.followTokenIdentities('all')
    expect(identitiesStore.tokenIdentities?.map(identity => identity.category)).toEqual([categoryB])
  })

  // the reservation writes go under whichever wallet is active when they run, so a switch landing
  // between two of them must stop the rest rather than write them under the next wallet's key
  it('stops writing reservations when the wallet changes between two of them', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA, categoryB])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    // the first reservation's refresh is where the switch lands
    store.wallet.getMaxAmountToSend = vi.fn()
      .mockImplementationOnce(async () => {
        await store.resetWalletState({ resetDappConnections: false })
        return 0n
      })
      .mockResolvedValue(0n)

    await identitiesStore.refreshIdentities()

    const written = JSON.parse(localStorageMock.getItem('reservedUtxos-mainnet-testWallet') ?? '{}') as Record<string, unknown>
    expect(Object.keys(written)).toEqual([outpointOf(authUtxoA)])
  })

  // unnamed is a derived view: a naming entry may stay in the map, but a UTXO the resolved list
  // accounts for is never rendered as an unnamed card beside its named one
  it('does not render an unnamed card for a UTXO a resolved identity accounts for', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    identitiesStore.unnamedAuthheads = [authheadA]
    expect(identitiesStore.unnamedAuthheadCoins).toEqual([authUtxo])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.unnamedAuthheadCoins).toEqual([])
    expect(identitiesStore.identities?.[0]?.category).toBe(categoryA)
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
  })

  // detection runs after the resolve on every open; what the list already names must not come
  // back as an unnamed entry and a "new" count each time
  it('does not list again as unnamed what the resolve already names', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const { identitiesStore } = startStore([utxo(authheadA, 0)])
    await identitiesStore.refreshIdentities()
    // a publication marker on the authhead, which names nothing on its own
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
    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.unnamedAuthheads).toEqual([])
    expect(identitiesStore.unseenIdentities).toEqual([])
    expect(identitiesStore.unseenCount).toBe(0)
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
    expect(identitiesStore.announcement).toEqual([categoryB])
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
    expect(identitiesStore.announcement).toEqual([categoryA])
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
    expect(identitiesStore.unseenCount).toBe(2)
    expect(identitiesStore.announcement).toEqual([categoryB])
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
    expect(identitiesStore.dismissedIdentities).toEqual([categoryA])
  })

  // A BCH-only chain carries nothing on its identity output to name it. Protection cannot wait
  // for that: the coin is held back first, and naming it comes after.
  it('holds back an authhead it cannot name', async () => {
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

    expect(identitiesStore.unnamedAuthheads).toEqual([authheadA])
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
    // nothing was named, so nothing joined the identity list
    expect(identitiesStore.identityCategories).toEqual([])
  })

  it('releases an unnamed authhead the user drops, and does not list it again', async () => {
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

    await identitiesStore.removeUnnamedAuthhead(authheadA)
    await identitiesStore.detectWalletIdentities(walk)

    expect(identitiesStore.unnamedAuthheads).toEqual([])
    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([authUtxo])
  })

  // A chain that walked to a conclusion without a genesis must not be walked again on every wallet
  // open: that is up to the hop limit in fetches, for an answer that cannot have changed while the
  // authhead has not moved.
  it('tries to name an unnamed authhead from its registry once per session', async () => {
    const authUtxo = utxo(authheadA, 0)
    const queried: string[] = []
    // a chain whose authhead published nothing the wallet can read: the naming concludes
    stubIdentityServers({ [authheadA]: { authhead: authheadA } }, {}, hash => queried.push(hash))
    const { store, identitiesStore } = startStore([authUtxo])
    await identitiesStore.detectWalletIdentities([publicationRow(authheadA)])
    expect(identitiesStore.unnamedAuthheads).toEqual([authheadA])

    await identitiesStore.nameUnnamedAuthheads()
    const afterFirst = queried.filter(hash => hash === authheadA).length
    expect(afterFirst).toBeGreaterThan(0)
    await identitiesStore.nameUnnamedAuthheads()

    // still protected, and not asked a second time
    expect(queried.filter(hash => hash === authheadA)).toHaveLength(afterFirst)
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
  })

  // a naming pass cut short by a wallet switch must not write what it had named under the next wallet
  it('writes nothing from a naming pass the wallet switched away from', async () => {
    const content = registryNaming(categoryA)
    const { store, identitiesStore } = startStore([utxo(authheadA, 0), utxo(authheadB, 0)])
    stubIdentityServers({
      [authheadA]: { authhead: authheadA, publication: publicationOf(content) },
      [categoryA]: { authhead: authheadA },
      [authheadB]: { authhead: authheadB },
    }, { 'https://example.com': content }, hash => {
      // the first chain names, then the wallet switches while the second is being asked
      if (hash === authheadB) store.walletSwitchedSince = () => true
    })
    await identitiesStore.detectWalletIdentities([publicationRow(authheadA), publicationRow(authheadB)])

    await identitiesStore.nameUnnamedAuthheads()

    // the first name was listed before the switch; the lists the caller rewrites were not touched
    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.unnamedAuthheads).toEqual([authheadA, authheadB])
    expect(identitiesStore.unseenIdentities).toEqual([authheadA, authheadB])
  })

  // an unnamed authhead is news once, like a category: a chain the walk cannot name must not keep
  // the menus saying "new" forever
  it('counts an unnamed authhead as unseen until a visit, and not again after', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { identitiesStore } = startStore([authUtxo])
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
    expect(identitiesStore.unseenCount).toBe(1)
    expect(identitiesStore.announcement).toEqual([authheadA])

    identitiesStore.markIdentitiesSeen()
    expect(identitiesStore.unseenCount).toBe(0)

    await identitiesStore.detectWalletIdentities(walk)
    expect(identitiesStore.unseenCount).toBe(0)
    expect(identitiesStore.unnamedAuthheadCoins).toEqual([authUtxo])
  })

  // the dialog exists to say what was found by name, so it waits for the walk that names a
  // publication-only identity and for its registry, and announces the category rather than the txid
  // the registry the chain published names its authbase; resolved forward, it ends at this coin
  it('names an unnamed authhead from its registry and moves the news to the category', async () => {
    const content = registryNaming(categoryA)
    const authUtxo = utxo(authheadA, 0)
    stubIdentityServers({
      [authheadA]: { authhead: authheadA, publication: publicationOf(content) },
      [categoryA]: { authhead: authheadA },
    }, { 'https://example.com': content })
    const { store, identitiesStore } = startStore([authUtxo])
    await identitiesStore.detectWalletIdentities([publicationRow(authheadA)])
    expect(identitiesStore.unseenIdentities).toEqual([authheadA])

    expect(await identitiesStore.nameUnnamedAuthheads()).toBe(1)

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.unnamedAuthheads).toEqual([])
    expect(identitiesStore.unseenIdentities).toEqual([categoryA])
    expect(store.reservedUtxos[outpointOf(authUtxo)]).toBe('auth')
  })

  // a registry that names a different chain does not name this coin, however its hash checks out
  it('does not take a name whose chain ends elsewhere', async () => {
    const content = registryNaming(categoryA)
    stubIdentityServers({
      [authheadA]: { authhead: authheadA, publication: publicationOf(content) },
      [categoryA]: { authhead: authheadB },
    }, { 'https://example.com': content })
    const { identitiesStore } = startStore([utxo(authheadA, 0)])
    await identitiesStore.detectWalletIdentities([publicationRow(authheadA)])

    expect(await identitiesStore.nameUnnamedAuthheads()).toBe(0)

    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.unnamedAuthheads).toEqual([authheadA])
  })

  // the host is bound by the hash on chain: a file it serves that the publication did not commit
  // to names nothing, however plausible its contents
  it('does not take a name from a registry the publication did not commit to', async () => {
    const published = registryNaming(categoryA)
    const served = registryNaming(categoryA).replace('Named', 'Renamed')
    stubIdentityServers({
      [authheadA]: { authhead: authheadA, publication: publicationOf(published) },
      [categoryA]: { authhead: authheadA },
    }, { 'https://example.com': served })
    const { identitiesStore } = startStore([utxo(authheadA, 0)])
    await identitiesStore.detectWalletIdentities([publicationRow(authheadA)])

    expect(await identitiesStore.nameUnnamedAuthheads()).toBe(0)

    expect(identitiesStore.identityCategories).toEqual([])
    expect(identitiesStore.unnamedAuthheads).toEqual([authheadA])
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
