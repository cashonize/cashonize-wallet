import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type * as WizardconnectWallet from '@wizardconnect/wallet'
import type { RelayConnectionState } from '@wizardconnect/wallet'
import type * as WizardconnectStore from '../src/stores/wizardconnectStore'

// Import mocks FIRST
import { localStorageMock } from './mocks/store.mocks'

// Stands in for the relay: a restored session starts without its dapp, which announces itself
// with dapp_ready only once it is open again
const managers: FakeManager[] = []
class FakeManager {
  connections: Record<string, RelayConnectionState> = {}
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  constructor() { managers.push(this) }
  on(event: string, handler: (...args: unknown[]) => void) {
    (this.handlers[event] ??= []).push(handler)
  }
  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers[event] ?? []) handler(...args)
  }
  connect(uri: string) {
    const id = `connection-${Object.keys(this.connections).length}`
    this.connections[id] = {
      id, uri, status: { status: 'connected' } as RelayConnectionState['status'],
      label: 'Connecting...', dappName: null, dappIcon: null, connectedAt: 0,
    }
  }
  // announces the dapp the way the manager does on dapp_ready
  dappReady(id: string, dappName: string, dappIcon: string | null) {
    const connection = this.connections[id]!
    Object.assign(connection, { dappName, dappIcon, label: dappName })
    this.emit('connectionStatusChanged', id, connection.status)
  }
  getConnections() { return { ...this.connections } }
  disconnect(id: string) { delete this.connections[id] }
  removeAllListeners() { this.handlers = {} }
  disconnectAll() { this.connections = {} }
}

// dialogs the store opens, which the tests never reach and vitest does not compile
vi.mock('src/components/walletconnect/WC2TransactionRequest.vue', () => ({ default: {} }))
vi.mock('src/components/wizardconnect/WizPairingDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/alertDialog.vue', () => ({ default: {} }))

vi.mock('@wizardconnect/wallet', async (importOriginal) => ({
  ...await importOriginal<typeof WizardconnectWallet>(),
  WalletConnectionManager: FakeManager,
}))

// Import stores after mocks
import { HDWallet } from 'mainnet-js'
import { useStore } from '../src/stores/store'
// the shared mocks stand in for this store too, so the real one is taken past them
const { useWizardconnectStore } = await vi.importActual<typeof WizardconnectStore>('../src/stores/wizardconnectStore')

const wizUri = 'wiz://test-dapp-pairing'

// A fresh Pinia over the same localStorage is an app reload
function openWallet() {
  setActivePinia(createPinia())
  const store = useStore()
  const wallet = Object.assign(new HDWallet(), {
    name: 'testWallet',
    network: 'mainnet',
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    derivation: "m/44'/145'/0'",
  })
  store.setWallet(wallet)
  const wizardconnectStore = useWizardconnectStore()
  wizardconnectStore.start()
  const manager = managers.at(-1)!
  const [connectionId, connection] = Object.entries(wizardconnectStore.connections)[0] ?? []
  return { store, wizardconnectStore, manager, connectionId, connection }
}

describe('WizardConnect dapp info across a reload', () => {
  beforeEach(() => {
    localStorageMock.clear()
    managers.length = 0
    const { store } = openWallet()
    localStorageMock.setItem('wizardConnectUris', JSON.stringify({ [`${store.network}:${store.activeWalletName}`]: [wizUri] }))
  })

  it('names a restored session after its dapp while waiting for it', () => {
    const before = openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', 'https://app.cauldron.quest/icon.png')

    const { wizardconnectStore, connection } = openWallet()
    expect(wizardconnectStore.dappInfoFor(connection!)).toEqual({ name: 'Cauldron', icon: 'https://app.cauldron.quest/icon.png' })
    // the saved name must not make an absent dapp look present
    expect(connection!.dappName).toBeNull()
  })

  it('takes the name the dapp sends over the saved one', () => {
    const before = openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)

    const { wizardconnectStore, manager, connectionId } = openWallet()
    manager.dappReady(connectionId!, 'Cauldron DEX', null)
    expect(wizardconnectStore.dappInfoFor(wizardconnectStore.connections[connectionId!]!)?.name).toBe('Cauldron DEX')

    const { wizardconnectStore: afterReload, connection } = openWallet()
    expect(afterReload.dappInfoFor(connection!)?.name).toBe('Cauldron DEX')
  })

  it('forgets the dapp once its session is disconnected', () => {
    const before = openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)
    const savedDappInfo = () => JSON.parse(localStorageMock.getItem('wizardConnectDappInfo') ?? '{}') as object
    expect(savedDappInfo()).toHaveProperty([wizUri])

    before.wizardconnectStore.disconnectSession(before.connectionId!)
    expect(savedDappInfo()).not.toHaveProperty([wizUri])
  })
})
