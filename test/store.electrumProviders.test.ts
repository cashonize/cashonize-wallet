import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'

import { createFailoverProvider, createProvider, DefaultProvider, NetworkType, setGlobalProvider, type FailoverTransportOptions } from '@cashonize/bch-wallet-lib'
import { useSettingsStore } from '../src/stores/settingsStore'
import { displayAndLogError } from '../src/utils/errorHandling'

// The store reads the settings store as it loads, so the reactive settings are in place first:
// reactive, so that the store sees a server change as the settings menu makes it
const settings = reactive({
  ...vi.mocked(useSettingsStore)(),
  electrumServerMainnet: 'a.example', electrumServerChipnet: 'b.example',
  electrumModeMainnet: 'single', electrumModeChipnet: 'single',
})
vi.mocked(useSettingsStore).mockReturnValue(settings as never)
const { useStore } = await import('../src/stores/store')

// A provider told apart by the servers it was made for
function fakeProvider(server: string, options?: FailoverTransportOptions) {
  return {
    server,
    options,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(true),
    getRawTransactionObject: vi.fn().mockResolvedValue({ vin: [], vout: [] }),
  }
}
type FakeProvider = ReturnType<typeof fakeProvider>

// A wallet whose setProvider moves it, as the library's does
function walletOn(provider: FakeProvider) {
  const wallet = {
    ...mockMainnetWallet,
    provider,
    getUtxos: vi.fn().mockResolvedValue([]),
    getMaxAmountToSend: vi.fn().mockResolvedValue(0n),
    getHistory: vi.fn().mockResolvedValue([]),
    getRawHistory: vi.fn().mockResolvedValue([]),
    watchBalance: vi.fn().mockResolvedValue(async () => {}),
    watchTokenTransactions: vi.fn().mockResolvedValue(async () => {}),
    watchBlocks: vi.fn().mockResolvedValue(async () => {}),
    hasAddress: vi.fn().mockReturnValue(false),
    setProvider: vi.fn((next: FakeProvider) => {
      wallet.provider = next
      return Promise.resolve()
    }),
  }
  return wallet
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// The providers the store made, and the one it made for a server
const made: FakeProvider[] = []
function madeFor(server: string): FakeProvider {
  const provider = made.find(candidate => candidate.server === server)
  if (!provider) throw new Error(`no provider made for ${server}`)
  return provider
}

describe('the electrum providers of the selected servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    localStorageMock.setItem('network', 'mainnet')
    setActivePinia(createPinia())
    made.length = 0
    vi.mocked(createFailoverProvider).mockImplementation((_network, servers, options) => {
      const provider = fakeProvider(servers.join(','), options)
      made.push(provider)
      return Promise.resolve(provider as never)
    })
    settings.electrumServerMainnet = 'a.example'
    settings.electrumServerChipnet = 'b.example'
    settings.electrumModeMainnet = 'single'
    settings.electrumModeChipnet = 'single'
  })
  // the settings are shared, so a store left from an earlier test would react to them too
  afterEach(() => {
    useStore().$dispose()
  })

  // a wallet constructed anywhere starts on the library's global provider of its network
  it('makes each selected server the global provider of its network, and keeps it across wallet switches', async () => {
    const store = useStore()
    await flush()
    expect(setGlobalProvider).toHaveBeenCalledWith('mainnet', madeFor('wss://a.example:50004'))
    expect(setGlobalProvider).toHaveBeenCalledWith('testnet', madeFor('wss://b.example:50004'))

    const provider = madeFor('wss://a.example:50004')
    await store.setWallet(walletOn(provider) as never)
    await store.setWallet(walletOn(provider) as never)
    expect(createFailoverProvider).toHaveBeenCalledTimes(2)
  })

  it('replaces the provider on a server change, and disconnects the old one once the wallet is off it', async () => {
    const store = useStore()
    await flush()
    const oldProvider = madeFor('wss://a.example:50004')
    const wallet = walletOn(oldProvider)
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    settings.electrumServerMainnet = 'c.example'
    await nextTick()
    await flush()
    const newProvider = madeFor('wss://c.example:50004')
    // the next wallet constructed starts on the new server
    expect(setGlobalProvider).toHaveBeenLastCalledWith('mainnet', newProvider)
    expect(oldProvider.disconnect).not.toHaveBeenCalled()

    await store.selectElectrumProvider(NetworkType.Mainnet)
    await store.initializeWallet()
    expect(wallet.setProvider).toHaveBeenLastCalledWith(newProvider)
    expect(oldProvider.disconnect).toHaveBeenCalledOnce()
  })

  // a server address the library refuses must not stay the answer for that server
  it('makes the provider again after one that could not be made', async () => {
    vi.mocked(createFailoverProvider).mockRejectedValueOnce(new Error('Unsupported electrum server URL'))
    const store = useStore()
    await flush()

    await expect(store.selectElectrumProvider(NetworkType.Mainnet)).resolves.toBeUndefined()
    expect(createFailoverProvider).toHaveBeenCalledTimes(3)
  })

  it('disconnects a replaced provider no wallet is on at once', async () => {
    const store = useStore()
    await flush()
    await store.setWallet(walletOn(madeFor('wss://a.example:50004')) as never)

    settings.electrumServerChipnet = 'd.example'
    await nextTick()
    await flush()
    expect(madeFor('wss://b.example:50004').disconnect).toHaveBeenCalledOnce()
    expect(madeFor('wss://a.example:50004').disconnect).not.toHaveBeenCalled()
  })

  // the library rolls the wallet back onto the old provider, which must stay until a move succeeds
  it('keeps the old provider while a move to the new server fails, and disconnects it once one succeeds', async () => {
    const store = useStore()
    await flush()
    const oldProvider = madeFor('wss://a.example:50004')
    const wallet = walletOn(oldProvider)
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    settings.electrumServerMainnet = 'c.example'
    await store.selectElectrumProvider(NetworkType.Mainnet)
    wallet.setProvider.mockRejectedValueOnce(new Error('unreachable'))
    await store.initializeWallet()
    expect(wallet.provider).toBe(oldProvider)
    expect(oldProvider.disconnect).not.toHaveBeenCalled()

    await store.initializeWallet()
    expect(wallet.provider).toBe(madeFor('wss://c.example:50004'))
    expect(oldProvider.disconnect).toHaveBeenCalledOnce()
  })

  // the move to the server changed away from fails as its provider is retired; only the newest
  // server's outcome is the user's to see
  it('ends on the last of two quick server changes, without an error for the one in between', async () => {
    const store = useStore()
    await flush()
    const first = madeFor('wss://a.example:50004')
    const wallet = walletOn(first)
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    let failMove!: (error: Error) => void
    wallet.setProvider.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failMove = reject }))
    settings.electrumServerMainnet = 'b2.example'
    await store.selectElectrumProvider(NetworkType.Mainnet)
    const slowMove = store.initializeWallet()
    await flush()

    settings.electrumServerMainnet = 'c.example'
    await store.selectElectrumProvider(NetworkType.Mainnet)
    await flush()
    // the wallet never got onto the one in between, so it goes at once
    expect(madeFor('wss://b2.example:50004').disconnect).toHaveBeenCalledOnce()
    failMove(new Error('The electrum transport was closed.'))
    await slowMove
    await store.initializeWallet()

    expect(wallet.provider).toBe(madeFor('wss://c.example:50004'))
    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(displayAndLogError).not.toHaveBeenCalled()
  })

  it('leaves no connection open on the network it switches away from', async () => {
    const store = useStore()
    await flush()
    const mainnetProvider = madeFor('wss://a.example:50004')
    await store.setWallet(walletOn(mainnetProvider) as never)

    await store.setWallet({ ...walletOn(madeFor('wss://b.example:50004')), network: 'testnet' } as never)
    await flush()
    expect(mainnetProvider.disconnect).toHaveBeenCalledOnce()
    // a fresh one for the same server takes its place, to connect once mainnet is used again
    expect(made.filter(provider => provider.server === 'wss://a.example:50004')).toHaveLength(2)
    expect(setGlobalProvider).toHaveBeenLastCalledWith('mainnet', made.at(-1))
  })

  it('refuses a server address the library does not take, before anything changes', async () => {
    const store = useStore()
    await flush()
    vi.mocked(createProvider).mockRejectedValueOnce(new Error('Unsupported electrum server URL'))

    await expect(store.validateElectrumServer('chipnet', 'not a server')).rejects.toThrow()
    await expect(store.validateElectrumServer('chipnet', 'fulcrum.example:50004')).resolves.toBeUndefined()
  })

  it('gives a single server alone to the provider and to the library defaults', async () => {
    useStore()
    await flush()
    expect(vi.mocked(createFailoverProvider).mock.calls[0]?.[1]).toEqual(['wss://a.example:50004'])

    settings.electrumServerMainnet = 'd.example'
    await nextTick()
    expect(vi.mocked(createFailoverProvider).mock.calls.at(-1)?.[1]).toEqual(['wss://d.example:50004'])
    expect(DefaultProvider.servers.mainnet).toEqual(['wss://d.example:50004'])
  })

  it('under automatic starts at the last server that worked, and remembers the one the provider settles on', async () => {
    settings.electrumModeMainnet = 'automatic'
    localStorageMock.setItem('electrumLastGood-mainnet', 'fulcrum.greyh.at')
    useStore()
    await flush()
    const servers = vi.mocked(createFailoverProvider).mock.calls[0]?.[1]
    expect(servers?.[0]).toBe('wss://fulcrum.greyh.at:50004')
    expect(servers).toHaveLength(8)

    made[0]!.options!.onServerChange!('wss://bch.loping.net:50004')
    expect(localStorageMock.getItem('electrumLastGood-mainnet')).toBe('bch.loping.net')
  })

  it('under preferred does not move the pick from the front for the server a failover took', async () => {
    settings.electrumModeMainnet = 'preferred'
    settings.electrumServerMainnet = 'cashnode.bch.ninja'
    const store = useStore()
    await flush()
    made[0]!.options!.onServerChange!('wss://bch.loping.net:50004')
    expect(localStorageMock.getItem('electrumLastGood-mainnet')).toBeNull()

    // the next open starts at the pick again
    await store.setWallet(walletOn(made[0]!) as never)
    await store.setWallet({ ...walletOn(made[1]!), network: 'testnet' } as never)
    await flush()
    expect(made.at(-1)!.server.split(',')[0]).toBe('wss://cashnode.bch.ninja:50004')
  })

  it('names the server in use when the wallet cannot connect', async () => {
    settings.electrumModeMainnet = 'automatic'
    const store = useStore()
    await flush()
    const provider = made[0]!
    provider.options!.onServerChange!('wss://bch.loping.net:50004')
    const wallet = walletOn(provider)
    wallet.setProvider.mockRejectedValueOnce(new Error('lost'))
    await store.setWallet(wallet as never)
    await store.initializeWallet()

    expect(vi.mocked(displayAndLogError).mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining('bch.loping.net') })
  })

  it('makes a new provider on a mode change', async () => {
    useStore()
    await flush()
    settings.electrumModeMainnet = 'automatic'
    await nextTick()
    await flush()
    expect(vi.mocked(createFailoverProvider).mock.calls.at(-1)?.[1]).toHaveLength(8)
  })
})
