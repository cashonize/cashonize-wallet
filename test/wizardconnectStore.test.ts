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
  // whether the dapps were told their session ended
  toldDisconnected = false
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
  disconnectAll() { this.connections = {}; this.toldDisconnected = true }
  closeAll() { this.connections = {} }
}

// dialogs the store opens, which the tests never reach and vitest does not compile
vi.mock('src/components/walletconnect/WC2TransactionRequest.vue', () => ({ default: {} }))
vi.mock('src/components/wizardconnect/WizPairingDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/alertDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/sendSuccessDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/sendConfirmDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/dappRequestErrorDialog.vue', () => ({ default: {} }))

vi.mock('@wizardconnect/wallet', async (importOriginal) => ({
  ...await importOriginal<typeof WizardconnectWallet>(),
  WalletConnectionManager: FakeManager,
}))

// Import stores after mocks
import { HDWallet } from '@cashonize/bch-wallet-lib'
import { useStore } from '../src/stores/store'
// the shared mocks stand in for this store too, so the real one is taken past them
const { useWizardconnectStore, removeWizardConnectSessions } = await vi.importActual<typeof WizardconnectStore>('../src/stores/wizardconnectStore')

const wizUri = 'wiz://test-dapp-pairing'

function hdWallet(name: string) {
  return Object.assign(new HDWallet(), {
    name,
    network: 'mainnet',
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    derivation: "m/44'/145'/0'",
    stop: () => Promise.resolve(),
  })
}
// the key the sessions of the wallet opened below are saved under
const walletKey = 'mainnet:testWallet'

// A fresh Pinia over the same localStorage is an app reload
async function openWallet() {
  setActivePinia(createPinia())
  const store = useStore()
  await store.setWallet(hdWallet('testWallet'))
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
    localStorageMock.setItem('wizardConnectUris', JSON.stringify({ [walletKey]: [wizUri] }))
  })

  it('names a restored session after its dapp while waiting for it', async () => {
    const before = await openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', 'https://app.cauldron.quest/icon.png')

    const { wizardconnectStore, connection } = await openWallet()
    expect(wizardconnectStore.dappInfoFor(connection!)).toEqual({ name: 'Cauldron', icon: 'https://app.cauldron.quest/icon.png' })
    // the saved name must not make an absent dapp look present
    expect(connection!.dappName).toBeNull()
  })

  it('takes the name the dapp sends over the saved one', async () => {
    const before = await openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)

    const { wizardconnectStore, manager, connectionId } = await openWallet()
    manager.dappReady(connectionId!, 'Cauldron DEX', null)
    expect(wizardconnectStore.dappInfoFor(wizardconnectStore.connections[connectionId!]!)?.name).toBe('Cauldron DEX')

    const { wizardconnectStore: afterReload, connection } = await openWallet()
    expect(afterReload.dappInfoFor(connection!)?.name).toBe('Cauldron DEX')
  })

  it('forgets the dapp once its session is disconnected', async () => {
    const before = await openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)
    const savedDappInfo = () => JSON.parse(localStorageMock.getItem('wizardConnectDappInfo') ?? '{}') as object
    expect(savedDappInfo()).toHaveProperty([wizUri])

    before.wizardconnectStore.disconnectSession(before.connectionId!)
    expect(savedDappInfo()).not.toHaveProperty([wizUri])
  })
})

describe('WizardConnect clearing all dapp connections', () => {
  beforeEach(() => {
    localStorageMock.clear()
    managers.length = 0
  })

  it('ends the live session and leaves nothing to restore after a reload, for any wallet', async () => {
    localStorageMock.setItem('wizardConnectUris', JSON.stringify({
      [walletKey]: [wizUri],
      'mainnet:otherWallet': ['wiz://other-dapp-pairing'],
    }))
    const before = await openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)

    expect(before.wizardconnectStore.forgetAllSessions()).toBe(true)
    expect(before.manager.toldDisconnected).toBe(true)
    expect(before.manager.getConnections()).toEqual({})
    expect(localStorageMock.getItem('wizardConnectUris')).toBeNull()
    expect(localStorageMock.getItem('wizardConnectDappInfo')).toBeNull()

    const { connection } = await openWallet()
    expect(connection).toBeUndefined()
  })

  it('reports no live session when there was none', async () => {
    const { wizardconnectStore } = await openWallet()
    expect(wizardconnectStore.forgetAllSessions()).toBe(false)
  })
})

describe('WizardConnect sessions after the wallet is left', () => {
  const savedUris = () => JSON.parse(localStorageMock.getItem('wizardConnectUris') ?? '{}') as Record<string, string[]>

  beforeEach(() => {
    localStorageMock.clear()
    managers.length = 0
    localStorageMock.setItem('wizardConnectUris', JSON.stringify({ [walletKey]: [wizUri] }))
  })

  it('a switch closes the sessions without ending them, and switching back resumes them', async () => {
    const { store, wizardconnectStore, manager } = await openWallet()
    // switchWallet names the new wallet before resetWalletState stops the old one's sessions
    store.activeWalletName = 'otherWallet'
    wizardconnectStore.stop()
    expect(manager.getConnections()).toEqual({})
    expect(manager.toldDisconnected).toBe(false)
    expect(wizardconnectStore.connections).toEqual({})
    expect(savedUris()).toEqual({ [walletKey]: [wizUri] })

    // the wallet switched to has no sessions of its own
    await store.setWallet(hdWallet('otherWallet'))
    wizardconnectStore.start()
    expect(wizardconnectStore.connections).toEqual({})
    wizardconnectStore.stop()

    await store.setWallet(hdWallet('testWallet'))
    wizardconnectStore.start()
    expect(Object.values(wizardconnectStore.connections).map(connection => connection.uri)).toEqual([wizUri])
  })

  it('deleting a wallet forgets its sessions on every network, so a new wallet under its name restores none', async () => {
    const before = await openWallet()
    before.manager.dappReady(before.connectionId!, 'Cauldron', null)
    localStorageMock.setItem('wizardConnectUris', JSON.stringify({
      ...savedUris(),
      'chipnet:testWallet': ['wiz://chipnet-pairing'],
      'mainnet:otherWallet': ['wiz://other-dapp-pairing'],
    }))

    removeWizardConnectSessions('testWallet')
    expect(savedUris()).toEqual({ 'mainnet:otherWallet': ['wiz://other-dapp-pairing'] })
    expect(JSON.parse(localStorageMock.getItem('wizardConnectDappInfo') ?? '{}')).not.toHaveProperty([wizUri])

    const { connection } = await openWallet()
    expect(connection).toBeUndefined()
  })
})
