import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Utxo } from 'mainnet-js'

import {
  localStorageMock,
  mockMainnetWallet,
} from './mocks/store.mocks'

import { useStore } from '../src/stores/store'
import { useIdentitiesStore } from '../src/stores/identitiesStore'
import { authGuardAddresses } from '../src/utils/tools/authGuard'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'
import { encodeCashAddress, hexToBin } from '@bitauth/libauth'

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

// Answers the authhead query for every mapped category and rejects for any other, the way an
// unreachable server would, which is what puts an identity in the 'unresolved' state
function stubAuthheadQueries(authheads: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const { variables } = JSON.parse(options.body as string) as { variables: { hash?: string } }
    const category = Object.keys(authheads).find(listed => variables.hash === `\\x${listed}`)
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

function startStore(walletUtxos: Utxo[], guardUtxos: Record<string, Utxo[]> = {}) {
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  store.setWallet(createMockWallet() as never)
  // setWallet gives the wallet its own network provider, so the covenant responder goes on after
  // it: these lookups ask the wallet's electrum about an address that is not the wallet's
  const provider = store.wallet.provider as unknown as { getUtxos: unknown }
  provider.getUtxos = vi.fn((address: string) => Promise.resolve(guardUtxos[address] ?? []))
  store.walletUtxos = walletUtxos
  return { store, identitiesStore }
}

// An AuthKey is an NFT with nothing on it: no name, no value, commitment 00. What makes it a key
// is the covenant its category derives, which is why it is only confirmed by looking there.
const authKeyCategory = '1122334455667788'.repeat(4)
const authKeyUtxo: Utxo = {
  txid: 'ee'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
  token: { category: authKeyCategory, amount: 0n, nft: { commitment: '00', capability: 'none' } },
}
const guardTokenAddress = authGuardAddresses(authKeyCategory, 'bitcoincash').p2sh20.tokenAddress

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

  // a key candidate is a shape guess about an NFT: the token item nudges, the menus do not
  it('asks about a key candidate once, and never again for that category', () => {
    const { identitiesStore } = startStore([authKeyUtxo])
    expect(identitiesStore.unexaminedKeyCandidates).toEqual([authKeyCategory])
    expect(identitiesStore.identitiesNeedAttention).toBe(false)

    identitiesStore.markKeyCandidatesExamined()

    expect(identitiesStore.unexaminedKeyCandidates).toEqual([])
  })

  it('remembers the answer across wallet opens', () => {
    const first = startStore([authKeyUtxo])
    first.identitiesStore.markKeyCandidatesExamined()

    setActivePinia(createPinia())
    const reopened = startStore([authKeyUtxo])

    expect(reopened.identitiesStore.unexaminedKeyCandidates).toEqual([])
  })

  // only a category nobody has been asked about is a candidate again
  it('asks again for a candidate that was not there before', () => {
    const { store, identitiesStore } = startStore([authKeyUtxo])
    identitiesStore.markKeyCandidatesExamined()

    const otherCandidate: Utxo = {
      ...authKeyUtxo,
      txid: 'dd'.repeat(32),
      token: { category: categoryB, amount: 0n, nft: { commitment: '00', capability: 'none' } },
    }
    store.walletUtxos = [authKeyUtxo, otherCandidate]

    expect(identitiesStore.unexaminedKeyCandidates).toEqual([categoryB])
  })

  // a Studio user's keys list their identities without being asked; that is worth telling them
  it('reports an identity found through a key the way the walk reports one', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    const guardedOutput = utxo(authheadA, 0, { category: categoryA, amount: 0n })
    const { identitiesStore } = startStore([authKeyUtxo], { [guardTokenAddress]: [guardedOutput] })

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identityCategories).toContain(categoryA)
    expect(identitiesStore.unseenIdentities).toContain(categoryA)
    expect(identitiesStore.identitiesNeedAttention).toBe(true)

    identitiesStore.markIdentitiesSeen()
    identitiesStore.markKeyCandidatesExamined()
    expect(identitiesStore.identitiesNeedAttention).toBe(false)
  })
})

describe('the spent-outputs walk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    localStorageMock.setItem('network', 'mainnet')
  })

  // the walk lists what this wallet has spent, so its answer changes only when a UTXO of ours is
  // spent: detection at open and the portfolio share one answer until then
  it('is asked once until a held UTXO is gone', async () => {
    let walks = 0
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const { query } = JSON.parse(options.body as string) as { query: string }
      if (!query.includes('WalletSpentOutputs')) return Promise.reject(new TypeError('Failed to fetch'))
      walks += 1
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { search_output: [] } }) })
    }))
    const { store } = startStore([utxo('aa'.repeat(32), 1)])
    // the walk is keyed by the wallet's public key hash, which the placeholder address has none of;
    // a made-up hash rather than any real address
    const madeUp = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hexToBin('11'.repeat(20)) })
    store.wallet.getDepositAddress = () => madeUp.address

    await store.fetchWalletAnnouncedAssets()
    await store.fetchWalletAnnouncedAssets()
    expect(store.announcedAssetsError).toBeUndefined()
    expect(walks).toBe(1)

    store.walletUtxos = []
    await store.fetchWalletAnnouncedAssets()
    expect(walks).toBe(2)
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

    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // the authhead moves to a new outpoint whenever the metadata is updated elsewhere
  it('moves the reservation when the authhead moved to another coin', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const oldAuthUtxo = utxo(authheadA, 0)
    const newAuthUtxo = utxo(movedAuthheadA, 0)
    const { store, identitiesStore } = startStore([oldAuthUtxo, newAuthUtxo])
    await identitiesStore.refreshIdentities()

    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await identitiesStore.refreshIdentities()

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
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    await identitiesStore.refreshIdentities()

    // categoryA now answers with a different authhead, categoryB's query fails outright
    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.find(identity => identity.category === categoryB)?.status).toBe('unresolved')
    expect(store.reservedUtxos[outpointOf(authUtxoA)]?.reason).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]?.reason).toBe('auth')
  })

  it('leaves a reservation another feature made alone', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    await store.reserveUtxo(authUtxo, 'pledge')

    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('pledge')
  })

  // the scan writes the identity categories and hands the resolving over, so it can never publish
  // a partial list that the drop pass then reads as "these authheads are gone"
  it('keeps a listed identity reserved through a scan that finds another one', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB })
    listIdentities([categoryA])
    const authUtxoA = utxo(authheadA, 0)
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoA, authUtxoB])
    await identitiesStore.refreshIdentities()
    // categoryB is a held token category the list does not cover yet
    store.tokenList = [{ category: categoryB, amount: 100n }]

    const summary = await identitiesStore.scanForIdentities()

    expect(summary).toEqual({ found: 1, alreadyListed: 0, carriesTokens: 0, mintingNfts: 0, failed: 0, dismissed: 0, deepScanned: 0 })
    expect(store.reservedUtxos[outpointOf(authUtxoA)]?.reason).toBe('auth')
    expect(store.reservedUtxos[outpointOf(authUtxoB)]?.reason).toBe('auth')
    expect(identitiesStore.identityCategories).toEqual([categoryA, categoryB])
  })

  // "no new identities found" from a check that could not ask would be a wrong answer, not a
  // missing one, so an outage aborts the check with the server's reason
  it('aborts the check with the reason when every category fails to resolve', async () => {
    stubAuthheadQueries({})
    const { store, identitiesStore } = startStore([utxo(authheadB, 0)])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryB, amount: 100n }]

    await expect(identitiesStore.scanForIdentities()).rejects.toThrow()
    expect(identitiesStore.identityCategories).toEqual([])
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
    expect(identitiesStore.unnamedAuthheadCoins()).toEqual([authUtxo])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.unnamedAuthheadCoins()).toEqual([])
    expect(identitiesStore.identities?.[0]?.category).toBe(categoryA)
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
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

  // the developer option runs the category half of the check on open: a find joins the list and
  // the trail like a detected one, an outage lands on the page rather than in a toast
  it('finds a received identity on open when the option is on, and reports an outage', async () => {
    stubAuthheadQueries({ [categoryB]: authheadB })
    const authUtxoB = utxo(authheadB, 0)
    const { store, identitiesStore } = startStore([authUtxoB])
    await identitiesStore.refreshIdentities()
    store.tokenList = [{ category: categoryB, amount: 100n }]

    await identitiesStore.checkHeldCategoriesOnOpen()

    expect(identitiesStore.identityCategories).toEqual([categoryB])
    expect(identitiesStore.unseenIdentities).toEqual([categoryB])
    expect(store.reservedUtxos[outpointOf(authUtxoB)]?.reason).toBe('auth')
    expect(identitiesStore.openCheckError).toBeUndefined()

    stubAuthheadQueries({})
    store.tokenList = [{ category: categoryA, amount: 100n }]
    await identitiesStore.checkHeldCategoriesOnOpen()

    expect(identitiesStore.openCheckError).toEqual(expect.any(String))
    expect(identitiesStore.identityCategories).toEqual([categoryB])
  })

  // an authhead carrying a token reserve is protected the same way, now that a reservation binds
  // for a token coin; what it carries has no actions yet, so the card only reports it
  it('holds back an authhead that carries a token reserve', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const authUtxo = utxo(authheadA, 0, { category: categoryA, amount: 1000n })
    const { store, identitiesStore } = startStore([authUtxo])

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('carriesTokens')
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // the AuthGuard standard: the identity output lives in a covenant, and the wallet holds the key
  // that opens it. Authority over the identity without the coin.
  it('finds an identity its AuthKey guards, and reserves the key', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    const guardedOutput: Utxo = {
      txid: authheadA, vout: 0, satoshis: 1000n, address: guardTokenAddress,
      token: { category: categoryA, amount: 500n },
    }
    const { store, identitiesStore } = startStore([authKeyUtxo], { [guardTokenAddress]: [guardedOutput] })

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('heldViaKey')
    expect(identitiesStore.identities?.[0]?.category).toBe(categoryA)
    // the key carries the authority, so the key is what gets held back
    expect(store.reservedUtxos[outpointOf(authKeyUtxo)]?.reason).toBe('auth')
    expect(store.spendableUtxos).toEqual([])
  })

  // an older identity output left in the guard is not the authhead, and does not make the wallet
  // the identity's keeper
  it('does not claim a guarded output that is not the authhead', async () => {
    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    listIdentities([categoryA])
    const staleOutput: Utxo = {
      txid: authheadA, vout: 0, satoshis: 1000n, address: guardTokenAddress,
      token: { category: categoryA, amount: 500n },
    }
    const { store, identitiesStore } = startStore([authKeyUtxo], { [guardTokenAddress]: [staleOutput] })

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identities?.[0]?.status).toBe('notHeld')
    expect(store.reservedUtxos).toEqual({})
  })

  // a commitment-00 NFT is a cheap local guess, and freezing on a guess would lock an innocent
  // NFT with no way back
  it('leaves an NFT that only looks like a key alone', async () => {
    const { store, identitiesStore } = startStore([authKeyUtxo])

    await identitiesStore.refreshIdentities()

    expect(store.reservedUtxos).toEqual({})
    expect(store.spendableUtxos).toEqual([authKeyUtxo])
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
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
    // and it says so, rather than the coin quietly becoming unspendable: a dialog the first time
    expect(identitiesStore.unseenIdentities).toEqual([categoryA])
    expect(identitiesStore.announcement).toEqual([categoryA])
    // the wallet page opens the dialog and clears the announcement
    identitiesStore.announcement = undefined

    // a later find only counts in the menus; the dialog is the once-per-wallet introduction
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
    expect(identitiesStore.announcement).toBeUndefined()
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
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
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
  it('walks an unnameable authhead once per session', async () => {
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    // a chain that goes nowhere: the walk concludes rather than failing to fetch
    const fetched: string[] = []
    const provider = store.wallet.provider as unknown as { getRawTransactionObject: unknown }
    provider.getRawTransactionObject = vi.fn((txid: string) => {
      fetched.push(txid)
      return Promise.resolve({ vin: [{ txid: categoryA, vout: 2 }], vout: [] })
    })
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
    const afterFirst = fetched.length
    expect(afterFirst).toBeGreaterThan(0)

    await identitiesStore.nameUnnamedAuthheads()

    // still protected, and not walked a second time
    expect(fetched).toHaveLength(afterFirst)
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
  })

  // the dialog exists to say what was found by name, so it waits for the walk that names a
  // publication-only identity and for its registry, and announces the category rather than the txid
  it('announces a named identity by its category, not the txid the walk started from', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    const authUtxo = utxo(authheadA, 0)
    const { store, identitiesStore } = startStore([authUtxo])
    const provider = store.wallet.provider as unknown as { getRawTransactionObject: unknown }
    // the walk names a chain at the genesis: the link that mints the category its input 0 spent
    provider.getRawTransactionObject = vi.fn(() => Promise.resolve({
      vin: [{ txid: categoryA, vout: 0 }],
      vout: [{ tokenData: { category: categoryA } }],
    }))
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

    expect(identitiesStore.identityCategories).toEqual([categoryA])
    expect(identitiesStore.unseenIdentities).toEqual([categoryA])
    expect(identitiesStore.announcement).toEqual([categoryA])
    expect(store.reservedUtxos[outpointOf(authUtxo)]?.reason).toBe('auth')
  })

  // A cached chain ends at the authhead it was fetched for. Once that authhead moves, whether this
  // wallet moved it or the same keys did elsewhere, the cache is missing its newest link.
  it('forgets a cached history once its authhead has moved', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const { identitiesStore } = startStore([utxo(authheadA, 0), utxo(movedAuthheadA, 0)])
    await identitiesStore.refreshIdentities()
    identitiesStore.identityHistories = { [categoryA]: [{ hash: authheadA, kind: 'genesis', reserve: 0n, reserveDelta: 0n }] }

    stubAuthheadQueries({ [categoryA]: movedAuthheadA })
    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identityHistories[categoryA]).toBeUndefined()
  })

  it('keeps a cached history while its authhead has not moved', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA })
    listIdentities([categoryA])
    const { identitiesStore } = startStore([utxo(authheadA, 0)])
    await identitiesStore.refreshIdentities()
    const cached = [{ hash: authheadA, kind: 'genesis' as const, reserve: 0n, reserveDelta: 0n }]
    identitiesStore.identityHistories = { [categoryA]: cached }

    await identitiesStore.refreshIdentities()

    expect(identitiesStore.identityHistories[categoryA]).toEqual(cached)
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
