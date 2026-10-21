import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  Config,
  NFTCapability,
  TokenBurnRequest,
  TokenMintRequest,
  TokenSendRequest,
  BroadcastTimeoutError,
  UtxoNotAvailableError,
  Wallet,
  removeGlobalProvider,
  setGlobalProvider,
  type ElectrumNetworkProvider,
  type Utxo,
} from '@cashonize/bch-wallet-lib'
import type * as BchWalletLib from '@cashonize/bch-wallet-lib'
import { binToHex, cashAddressToLockingBytecode, createVirtualMachineBch, decodeTransaction, hexToBin } from '@bitauth/libauth'

// The store's spend paths on a real bch-wallet-lib wallet, every library call built with
// broadcast: false, so what is checked is the inputs of the transaction the store would have sent:
// a reserved coin, BCH or token, is never one of them. The rest of the store is mocked away.

const storage = vi.hoisted(() => {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const key of Object.keys(store)) delete store[key] },
  }
})
vi.stubGlobal('localStorage', storage)

// The provider the wallets run on: the store makes the one createProvider returns the global
// provider of mainnet, where a wallet is constructed
const { fakeProvider } = vi.hoisted(() => ({
  fakeProvider: {
    network: 'mainnet',
    connect: () => Promise.resolve(),
    subscribeToAddress: (address: string, callback: (data: [string, string]) => void) => {
      queueMicrotask(() => callback([address, 'status']))
      return Promise.resolve(() => Promise.resolve())
    },
    getUtxos: () => Promise.resolve(walletCoins),
    getHistory: () => Promise.resolve([]),
    getBlockHeight: () => Promise.resolve(900_000),
  } as unknown as ElectrumNetworkProvider,
}))
vi.mock('@cashonize/bch-wallet-lib', async (importOriginal) => ({
  ...await importOriginal<typeof BchWalletLib>(),
  createProvider: vi.fn().mockResolvedValue(fakeProvider),
}))
vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    electrumServerMainnet: 'electrum.imaginary.cash',
    electrumServerChipnet: 'chipnet.bch.ninja',
    featuredTokens: [],
    getWalletType: vi.fn().mockReturnValue('single'),
  })),
}))
vi.mock('src/stores/identitiesStore', () => ({
  useIdentitiesStore: vi.fn(() => ({ loadForWallet: vi.fn(), refreshIdentities: vi.fn() })),
}))
vi.mock('src/stores/walletconnectStore', () => ({ useWalletconnectStore: vi.fn(() => ({})) }))
vi.mock('src/stores/cashconnectStore', () => ({ useCashconnectStore: vi.fn(() => ({})) }))
vi.mock('src/stores/wizardconnectStore', () => ({ useWizardconnectStore: vi.fn(() => ({})) }))
vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }))
vi.mock('src/utils/errorHandling', () => ({ displayAndLogError: vi.fn() }))
vi.mock('src/utils/cacheUtils', () => ({ cachedFetch: vi.fn() }))

import { useStore } from '../src/stores/store'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'
import { genesisOutputs, guardsAsPlanned } from '../src/utils/tools/tokenCreation'
import { publicationOutput } from '../src/utils/tools/authchainIdentity'
import { isAuthGuardOf } from '../src/utils/tools/authGuard'

// same throwaway key as wcSigning.test.ts
const throwAwayTestKeyWif = 'L15RRkJJdgWARpbwHaZV4a99ciHhKEmWz8bR8aQ5T94FqhfAw3Ac'
const category = '33'.repeat(32)
const minting = { capability: NFTCapability.minting, commitment: '' }

let walletCoins: Utxo[] = []

let address: string
let tokenAddress: string
let relayFeeBefore: number | undefined
beforeAll(async () => {
  relayFeeBefore = Config.RelayFeePerByte
  Config.RelayFeePerByte = 1
  setGlobalProvider('mainnet', fakeProvider)
  const keyWallet = await Wallet.fromWIF(throwAwayTestKeyWif)
  await keyWallet.stop()
  address = keyWallet.cashaddr
  tokenAddress = keyWallet.tokenaddr
})
afterAll(() => {
  removeGlobalProvider('mainnet')
  Config.RelayFeePerByte = relayFeeBefore
})

const coin = (txByte: string, satoshis: bigint, token?: Utxo['token']): Utxo =>
  ({ txid: txByte.repeat(32), vout: 0, satoshis, address, ...(token ? { token } : {}) })

// the transaction each library call built, kept back from the network
const built: string[] = []
type BuiltResponse = { transaction?: string }
function buildOnly<Args extends unknown[]>(method: (...args: Args) => Promise<BuiltResponse>, optionsAt: number) {
  return async (...args: Args) => {
    args[optionsAt] = { ...(args[optionsAt] as object | undefined), broadcast: false }
    const response = await method(...args)
    if (response.transaction) built.push(response.transaction)
    return response
  }
}

const openWallets: Wallet[] = []
async function storeHolding(coins: Utxo[], reserved: Utxo[]) {
  walletCoins = coins
  const wallet = await Wallet.fromWIF(throwAwayTestKeyWif)
  openWallets.push(wallet)
  wallet.send = buildOnly(wallet.send.bind(wallet), 1) as typeof wallet.send
  wallet.sendMax = buildOnly(wallet.sendMax.bind(wallet), 1) as typeof wallet.sendMax
  wallet.tokenMint = buildOnly(wallet.tokenMint.bind(wallet), 1) as typeof wallet.tokenMint
  wallet.tokenBurn = buildOnly(wallet.tokenBurn.bind(wallet), 2) as typeof wallet.tokenBurn
  // the store builds a genesis with broadcast off itself, checks it, then submits it
  wallet.submitTransaction = (transaction: Uint8Array) => {
    built.push(binToHex(transaction))
    return Promise.resolve('ab'.repeat(32))
  }
  const store = useStore()
  await store.setWallet(wallet)
  store.walletUtxos = await wallet.getUtxos()
  for (const utxo of reserved) await store.reserveOutpoints([outpointOf(utxo)], 'manual')
  return store
}

function spentOutpoints(transactionHex: string | undefined) {
  if (!transactionHex) throw new Error('no transaction built')
  const transaction = decodeTransaction(hexToBin(transactionHex))
  if (typeof transaction === 'string') throw new Error(transaction)
  return transaction.inputs.map(input => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
}

describe('a reserved coin is never an input of a store spend', () => {
  beforeEach(() => {
    built.length = 0
    storage.clear()
    storage.setItem('network', 'mainnet')
    setActivePinia(createPinia())
  })
  afterEach(async () => {
    await Promise.all(openWallets.splice(0).map(wallet => wallet.stop()))
  })

  it('send and sendMax leave a reserved BCH coin out', async () => {
    const reserved = coin('11', 100_000n)
    const spendable = coin('22', 50_000n)
    const store = await storeHolding([reserved, spendable], [reserved])

    await store.spend.send([{ cashaddr: address, value: 1000n }])
    await store.spend.sendMax(address)

    expect(built.map(spentOutpoints)).toEqual([[outpointOf(spendable)], [outpointOf(spendable)]])
  })

  it('getMaxAmountToSend counts only the coins a spend may use', async () => {
    const store = await storeHolding([coin('11', 100_000n), coin('22', 50_000n)], [coin('11', 100_000n)])

    const max = await store.spend.getMaxAmountToSend()

    expect(max).toBeLessThan(50_000n)
    expect(max).toBeGreaterThan(49_000n)
  })

  it('a fungible send takes the spendable token coin, not the reserved one', async () => {
    const reserved = coin('11', 1000n, { category, amount: 500n })
    const spendable = coin('22', 1000n, { category, amount: 500n })
    const bch = coin('44', 50_000n)
    const store = await storeHolding([reserved, spendable, bch], [reserved])

    await store.spend.send([new TokenSendRequest({ cashaddr: tokenAddress, category, amount: 100n })])

    const inputs = spentOutpoints(built[0])
    expect(inputs).toContain(outpointOf(spendable))
    expect(inputs).not.toContain(outpointOf(reserved))
  })

  it('a fungible send larger than the spendable coins fails rather than take the reserved one', async () => {
    const reserved = coin('11', 1000n, { category, amount: 500n })
    const spendable = coin('22', 1000n, { category, amount: 500n })
    const store = await storeHolding([reserved, spendable, coin('44', 50_000n)], [reserved])

    await expect(store.spend.send([new TokenSendRequest({ cashaddr: tokenAddress, category, amount: 800n })]))
      .rejects.toThrow(/held back/)
    expect(built).toEqual([])
  })

  it('a mint refuses a reserved minting NFT', async () => {
    const reservedMinting = coin('11', 1000n, { category, amount: 0n, nft: minting })
    const store = await storeHolding([reservedMinting, coin('44', 50_000n)], [reservedMinting])
    const request = new TokenMintRequest({ category, nft: { capability: NFTCapability.none, commitment: '01' } })

    await expect(store.spend.tokenMint(request)).rejects.toThrow()
    expect(built).toEqual([])
  })

  it('a burn takes the spendable token coin, not the reserved one', async () => {
    const reserved = coin('11', 1000n, { category, amount: 500n })
    const spendable = coin('22', 1000n, { category, amount: 500n })
    const bch = coin('44', 50_000n)
    const store = await storeHolding([reserved, spendable, bch], [reserved])

    await store.spend.tokenBurn(new TokenBurnRequest({ category, amount: 10n }), 'burn')

    const inputs = spentOutpoints(built[0])
    expect(inputs).toContain(outpointOf(spendable))
    expect(inputs).not.toContain(outpointOf(reserved))
  })

  it('a genesis spends the picked coin and no reserved one', async () => {
    const reserved = coin('11', 100_000n)
    const picked = coin('22', 10_000n)
    const store = await storeHolding([reserved, picked], [reserved])

    await store.spend.tokenGenesis([picked], [{ amount: 1000n, value: 1000n, cashaddr: tokenAddress }])

    expect(spentOutpoints(built[0])).toEqual([outpointOf(picked)])
  })

  // the authhead passes its own reservation and nothing else does
  it('an identity spend takes the authhead and no other reserved coin', async () => {
    const authhead = coin('11', 1000n, { category, amount: 100n, nft: minting })
    const frozen = coin('22', 100_000n)
    const bch = coin('44', 50_000n)
    const store = await storeHolding([authhead, frozen, bch], [frozen])
    await store.reserveOutpoints([outpointOf(authhead)], 'auth')
    const identityOutput = new TokenSendRequest({ cashaddr: tokenAddress, category, amount: 100n, nft: minting, value: 1000n })

    await store.spend.spendAuthUtxo(authhead, [identityOutput])

    const inputs = spentOutpoints(built[0])
    expect(inputs).toContain(outpointOf(authhead))
    expect(inputs).not.toContain(outpointOf(frozen))
  })
})

// a mutable NFT matched by commitment alone, gone since the page showed it, would be minted anew
// off the minting NFT; named in ensureUtxos, the send fails instead
describe('an NFT send spends the coin it names', () => {
  beforeEach(() => {
    built.length = 0
    storage.clear()
    storage.setItem('network', 'mainnet')
    setActivePinia(createPinia())
  })
  afterEach(async () => {
    await Promise.all(openWallets.splice(0).map(wallet => wallet.stop()))
  })

  const mutable = { capability: NFTCapability.mutable, commitment: '01' }

  it('spends the named mutable NFT', async () => {
    const nft = coin('11', 1000n, { category, amount: 0n, nft: mutable })
    const baton = coin('22', 1000n, { category, amount: 0n, nft: minting })
    const store = await storeHolding([nft, baton, coin('44', 50_000n)], [])

    await store.spend.send([new TokenSendRequest({ cashaddr: tokenAddress, category, nft: mutable })], [nft])

    const inputs = spentOutpoints(built[0])
    expect(inputs).toContain(outpointOf(nft))
    expect(inputs).not.toContain(outpointOf(baton))
  })

  it('refuses a mutable NFT spent elsewhere rather than mint it off the minting NFT', async () => {
    const vanished = coin('11', 1000n, { category, amount: 0n, nft: mutable })
    const baton = coin('22', 1000n, { category, amount: 0n, nft: minting })
    const store = await storeHolding([baton, coin('44', 50_000n)], [])

    await expect(store.spend.send([new TokenSendRequest({ cashaddr: tokenAddress, category, nft: mutable })], [vanished]))
      .rejects.toMatchObject({ cause: expect.any(UtxoNotAvailableError) })
    expect(built).toEqual([])
  })
})

// Preparing the AuthKey's genesis coin must not spend the token's, the one coin already picked
describe('a send that keeps a picked coin', () => {
  beforeEach(() => {
    built.length = 0
    storage.clear()
    storage.setItem('network', 'mainnet')
    setActivePinia(createPinia())
  })
  afterEach(async () => {
    await Promise.all(openWallets.splice(0).map(wallet => wallet.stop()))
  })

  it('pays from the other coins', async () => {
    const tokenCoin = coin('44', 50_000n)
    const other = coin('55', 30_000n)
    const store = await storeHolding([tokenCoin, other], [])

    await store.spend.sendKeeping([{ cashaddr: address, value: 10_000n }], [tokenCoin])

    expect(spentOutpoints(built[0])).toEqual([outpointOf(other)])
  })

  it('fails rather than spend the kept coin when it is the only one', async () => {
    const tokenCoin = coin('44', 50_000n)
    const store = await storeHolding([tokenCoin], [])

    await expect(store.spend.sendKeeping([{ cashaddr: address, value: 10_000n }], [tokenCoin])).rejects.toThrow()
    expect(built).toEqual([])
  })
})

// An AuthGuard genesis makes two categories, the token's and its AuthKey's, from the two coins the
// create page picked, in CashTokens Studio's order. Built by the library's own selection and
// signing, then checked by the VM's consensus rules: a genesis output's category must be the txid
// of an output-0 input this very transaction spends.
describe('an AuthGuard genesis', () => {
  beforeEach(() => {
    built.length = 0
    storage.clear()
    storage.setItem('network', 'mainnet')
    setActivePinia(createPinia())
  })
  afterEach(async () => {
    await Promise.all(openWallets.splice(0).map(wallet => wallet.stop()))
  })

  it('spends the token coin, then the key coin, into the guard and the key the VM accepts', async () => {
    // a vout-0 coin listed before the picked ones must not become either category
    const decoy = coin('11', 100_000n)
    const tokenCoin = coin('44', 10_000n)
    const keyCoin = coin('55', 10_000n)
    const store = await storeHolding([decoy, tokenCoin, keyCoin], [])
    const { genesisRequests, extraOutputs } = genesisOutputs({
      tokenCategory: tokenCoin.txid,
      keyCategory: keyCoin.txid,
      walletTokenAddress: tokenAddress,
      reserve: 700n,
      mintingNft: true,
      circulating: 300n,
      publication: publicationOutput('66'.repeat(32), ['example.com']),
    })

    await store.spend.tokenGenesis([tokenCoin, keyCoin], genesisRequests, extraOutputs, {
      verify: transaction => guardsAsPlanned(transaction, keyCoin.txid),
    })

    const transaction = decodeTransaction(hexToBin(built[0]!))
    if (typeof transaction === 'string') throw new Error(transaction)
    expect(spentOutpoints(built[0]).slice(0, 2)).toEqual([outpointOf(tokenCoin), outpointOf(keyCoin)])
    const [guard, key, circulation, publication] = transaction.outputs
    expect(binToHex(guard!.token!.category)).toBe(tokenCoin.txid)
    expect(isAuthGuardOf(keyCoin.txid, binToHex(guard!.lockingBytecode))).toBe(true)
    expect(binToHex(key!.token!.category)).toBe(keyCoin.txid)
    expect(binToHex(key!.token!.nft!.commitment)).toBe('00')
    expect(binToHex(circulation!.token!.category)).toBe(tokenCoin.txid)
    expect(publication!.lockingBytecode[0]).toBe(0x6a)

    const p2pkh = cashAddressToLockingBytecode(address)
    if (typeof p2pkh === 'string') throw new Error(p2pkh)
    const coinOf = new Map([decoy, tokenCoin, keyCoin].map(utxo => [outpointOf(utxo), utxo]))
    const sourceOutputs = spentOutpoints(built[0]).map(outpoint =>
      ({ lockingBytecode: p2pkh.bytecode, valueSatoshis: coinOf.get(outpoint)!.satoshis }))
    expect(createVirtualMachineBch(true).verify({ transaction, sourceOutputs })).toBe(true)
  })

  // the pool would take a coin listed twice once, and pin a coin nobody picked as the second category
  it('refuses the same coin picked twice', async () => {
    const tokenCoin = coin('44', 10_000n)
    const store = await storeHolding([tokenCoin, coin('55', 10_000n)], [])
    const request = { amount: 1n, cashaddr: tokenAddress }

    await expect(store.spend.tokenGenesis([tokenCoin, tokenCoin], [request, request])).rejects.toThrow(/no longer available/)
    expect(built).toEqual([])
  })

  it('sends nothing when the built genesis fails the caller\'s check', async () => {
    const tokenCoin = coin('44', 10_000n)
    const store = await storeHolding([tokenCoin, coin('55', 50_000n)], [])

    await expect(store.spend.tokenGenesis([tokenCoin], [{ amount: 1n, cashaddr: tokenAddress }], [], { verify: () => false }))
      .rejects.toThrow()
    expect(built).toEqual([])
  })

  // the transaction may have gone through, so the identity's coin is held back all the same
  it('holds back the new identity when the broadcast\'s outcome is unknown', async () => {
    const tokenCoin = coin('44', 10_000n)
    const store = await storeHolding([tokenCoin, coin('55', 50_000n)], [])
    const txid = 'cd'.repeat(32)
    store.wallet.submitTransaction = () => Promise.reject(new BroadcastTimeoutError('timed out', { txid, transaction: '0200' }))
    const holdBack = vi.fn(() => Promise.resolve())

    await expect(store.spend.tokenGenesis([tokenCoin], [{ amount: 1n, cashaddr: tokenAddress }], [], { holdBack })).rejects.toThrow()
    expect(holdBack).toHaveBeenCalledWith(txid)
  })
})
