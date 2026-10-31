import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  Config,
  NFTCapability,
  TokenBurnRequest,
  TokenMintRequest,
  TokenSendRequest,
  UtxoNotAvailableError,
  Wallet,
  removeGlobalProvider,
  setGlobalProvider,
  type ElectrumNetworkProvider,
  type Utxo,
} from '@cashonize/bch-wallet-lib'
import type * as BchWalletLib from '@cashonize/bch-wallet-lib'
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth'

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

// The provider the wallets run on: the store makes the one createFailoverProvider returns the global
// provider of mainnet, where a wallet is constructed
const { fakeProvider } = vi.hoisted(() => ({
  fakeProvider: {
    network: 'mainnet',
    subscribeToAddress: (address: string, callback: (data: [string, string]) => void) => {
      queueMicrotask(() => callback([address, 'status']))
      return Promise.resolve(() => Promise.resolve())
    },
    getUtxos: () => Promise.resolve(walletCoins),
    getHistory: () => Promise.resolve([]),
  } as unknown as ElectrumNetworkProvider,
}))
vi.mock('@cashonize/bch-wallet-lib', async (importOriginal) => ({
  ...await importOriginal<typeof BchWalletLib>(),
  createFailoverProvider: vi.fn().mockResolvedValue(fakeProvider),
}))
vi.mock('src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    electrumServer: { mainnet: 'electrum.imaginary.cash', chipnet: 'chipnet.bch.ninja', testnet4: 'testnet4.imaginary.cash' },
    electrumMode: { mainnet: 'single', chipnet: 'single', testnet4: 'single' },
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
// the real quota check, which tells a full localStorage from other write failures
vi.mock('src/utils/errorHandling', async (importOriginal) => ({
  isQuotaExceededError: (await importOriginal<typeof ErrorHandling>()).isQuotaExceededError,
  displayAndLogError: vi.fn(),
}))
vi.mock('src/utils/cacheUtils', () => ({ cachedFetch: vi.fn() }))

import { Notify } from 'quasar'
import type * as ErrorHandling from '../src/utils/errorHandling'
import { useStore } from '../src/stores/store'
import { outpointOf } from '../src/utils/wallet/reservedUtxos'

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
  tokenAddress = keyWallet.getTokenDepositAddress()
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
  wallet.tokenGenesis = buildOnly(wallet.tokenGenesis.bind(wallet), 2) as typeof wallet.tokenGenesis
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

  it('a reserved coin stays out of a spend after an electrum server change', async () => {
    const reserved = coin('11', 100_000n)
    const spendable = coin('22', 50_000n)
    const store = await storeHolding([reserved, spendable], [reserved])

    // what the settings menu does on a server change: the same wallet, no setWallet
    await store.resetWalletState({ resetDappConnections: false })
    store.walletUtxos = [reserved, spendable]
    await store.spend.sendMax(address)

    expect(built.map(spentOutpoints)).toEqual([[outpointOf(spendable)]])
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

    await store.spend.tokenGenesis(picked, { amount: 1000n, value: 1000n, cashaddr: tokenAddress })

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

describe('a reservation storage cannot keep', () => {
  beforeEach(() => {
    storage.clear()
    setActivePinia(createPinia())
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(openWallets.splice(0).map(wallet => wallet.stop()))
  })

  // the coin must not look held back while it can be spent: the action fails and the user is told
  it('fails the reservation with a notice when localStorage is full', async () => {
    const unsaved = coin('11', 100_000n)
    const store = await storeHolding([unsaved, coin('44', 50_000n)], [])
    vi.mocked(Notify.create).mockClear()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await expect(store.reserveOutpoints([outpointOf(unsaved)], 'manual')).rejects.toThrow()
    expect(Notify.create).toHaveBeenCalledOnce()
    expect(store.storedReservations[outpointOf(unsaved)]).toBeUndefined()
  })
})
