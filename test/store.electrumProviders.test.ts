import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'

import { localStorageMock, mockMainnetWallet } from './mocks/store.mocks'

import { createProvider, NetworkType, setGlobalProvider } from '@cashonize/bch-wallet-lib'
import { useSettingsStore } from '../src/stores/settingsStore'

// The store reads the settings store as it loads, so the reactive settings are in place first:
// reactive, so that the store sees a server change as the settings menu makes it
const settings = reactive({ ...vi.mocked(useSettingsStore)(), electrumServerMainnet: 'a.example', electrumServerChipnet: 'b.example' })
vi.mocked(useSettingsStore).mockReturnValue(settings as never)
const { useStore } = await import('../src/stores/store')

// A provider told apart by the server it was made for
function fakeProvider(server: string) {
  return {
    server,
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
    vi.mocked(createProvider).mockImplementation((_network, servers) => {
      const provider = fakeProvider(servers as string)
      made.push(provider)
      return Promise.resolve(provider as never)
    })
    settings.electrumServerMainnet = 'a.example'
    settings.electrumServerChipnet = 'b.example'
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
    expect(createProvider).toHaveBeenCalledTimes(2)
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
    vi.mocked(createProvider).mockRejectedValueOnce(new Error('Unsupported electrum server URL'))
    const store = useStore()
    await flush()

    await expect(store.selectElectrumProvider(NetworkType.Mainnet)).resolves.toBeUndefined()
    expect(createProvider).toHaveBeenCalledTimes(3)
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
})
