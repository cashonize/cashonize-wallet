import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type * as WalletconnectStore from '../src/stores/walletconnectStore'

// Import mocks FIRST
import { localStorageMock, mockClearAutoApproveState } from './mocks/store.mocks'

type Handler = (payload: unknown) => void
interface FakeSession { topic: string, namespaces: { bch: { accounts: string[] } }, peer: { metadata: { name: string, icons: string[] } } }

// Stands in for WalletKit: one set of sessions for the whole app, whichever wallet approved them
class FakeWalletKit {
  sessions: Record<string, FakeSession> = {}
  responses: { topic: string, response: { id: number, result?: unknown, error?: { code: number } } }[] = []
  disconnected: string[] = []
  private handlers: Record<string, Handler[]> = {}
  engine = { signClient: { events: { on: () => {} }, session: { delete: () => Promise.resolve() } } }
  on(event: string, handler: Handler) { (this.handlers[event] ??= []).push(handler) }
  async request(topic: string, method: string, id = 1) {
    for (const handler of this.handlers.session_request ?? []) handler({ id, topic, params: { request: { method, params: {} } } })
    // the store answers a request behind a fire-and-forget promise
    await new Promise(resolve => setTimeout(resolve))
  }
  addSession(topic: string, address: string) {
    this.sessions[topic] = { topic, namespaces: { bch: { accounts: [`bch:${address}`] } }, peer: { metadata: { name: 'Cauldron', icons: [] } } }
  }
  getActiveSessions() { return { ...this.sessions } }
  getPendingSessionRequests() { return [] }
  respondSessionRequest(answer: FakeWalletKit['responses'][number]) { this.responses.push(answer); return Promise.resolve() }
  disconnectSession({ topic }: { topic: string }) {
    delete this.sessions[topic]
    this.disconnected.push(topic)
    return Promise.resolve()
  }
}
let walletKit: FakeWalletKit

vi.mock('@reown/walletkit', () => ({ WalletKit: { init: () => Promise.resolve(walletKit) } }))
vi.mock('@walletconnect/core', () => ({ Core: class { eventClient = {} } }))
// dialogs the store opens, which the tests never reach and vitest does not compile
vi.mock('src/components/walletconnect/WC2TransactionRequest.vue', () => ({ default: {} }))
vi.mock('src/components/walletconnect/WCSignMessageRequest.vue', () => ({ default: {} }))
vi.mock('src/components/walletconnect/WC2SessionRequestDialog.vue', () => ({ default: {} }))
vi.mock('src/components/walletconnect/WC2AddressSelectDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/alertDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/sendSuccessDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/sendConfirmDialog.vue', () => ({ default: {} }))
vi.mock('src/components/general/dappRequestErrorDialog.vue', () => ({ default: {} }))

// Import stores after mocks
import { Notify } from 'quasar'
import { Wallet } from '@cashonize/bch-wallet-lib'
import { useStore } from '../src/stores/store'
// the shared mocks stand in for this store too, so the real one is taken past them
const { useWalletconnectStore } = await vi.importActual<typeof WalletconnectStore>('../src/stores/walletconnectStore')

function fakeWallet(name: string, network = 'mainnet') {
  return Object.assign(new Wallet(), { name, network, stop: () => Promise.resolve() })
}
const savedSessionWallets = () => JSON.parse(localStorageMock.getItem('walletConnectSessionWallets') ?? '{}') as Record<string, string>

// Two wallets with a session each, and the first one open
async function openWithSessions() {
  const store = useStore()
  await store.setWallet(fakeWallet('defi'))
  walletKit.addSession('topic-defi', 'bitcoincash:qdefi')
  walletKit.addSession('topic-nfts', 'bitcoincash:qnfts')
  localStorageMock.setItem('walletConnectSessionWallets', JSON.stringify({ 'topic-defi': 'mainnet:defi', 'topic-nfts': 'mainnet:nfts' }))
  const walletconnectStore = useWalletconnectStore()
  await walletconnectStore.initweb3wallet()
  return { store, walletconnectStore }
}

describe('WalletConnect sessions of several wallets', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.mocked(Notify.create).mockClear()
    mockClearAutoApproveState.mockClear()
    walletKit = new FakeWalletKit()
    setActivePinia(createPinia())
  })

  it('lists the sessions of the wallet that is open, and a switch ends none', async () => {
    const { store, walletconnectStore } = await openWithSessions()
    expect(Object.keys(walletconnectStore.activeSessions ?? {})).toEqual(['topic-defi'])

    await store.setWallet(fakeWallet('nfts'))
    expect(Object.keys(walletconnectStore.activeSessions ?? {})).toEqual(['topic-nfts'])

    await store.setWallet(fakeWallet('defi'))
    expect(Object.keys(walletconnectStore.activeSessions ?? {})).toEqual(['topic-defi'])
    expect(walletKit.disconnected).toEqual([])
  })

  it('refuses a signing request for a session of another wallet, and says which wallet it was for', async () => {
    await openWithSessions()
    for (const method of ['bch_signTransaction', 'bch_signMessage']) {
      walletKit.responses = []
      await walletKit.request('topic-nfts', method)
      expect(walletKit.responses).toHaveLength(1)
      expect(walletKit.responses[0]!.response.error?.code).toBe(4100)
    }
    const notice = vi.mocked(Notify.create).mock.calls[0]![0] as { message: string }
    expect(notice.message).toContain('Cauldron')
    expect(notice.message).toContain('"nfts"')
  })

  it('refuses a session of the same wallet on another network, the tied chipnet copy', async () => {
    const { store } = await openWithSessions()
    await store.setWallet(fakeWallet('defi', 'testnet'))
    await walletKit.request('topic-defi', 'bch_signTransaction')
    expect(walletKit.responses[0]!.response.error?.code).toBe(4100)
    const notice = vi.mocked(Notify.create).mock.calls[0]![0] as { message: string }
    expect(notice.message).toContain('mainnet')
  })

  it('answers an address request from the session itself while another wallet is open', async () => {
    await openWithSessions()
    await walletKit.request('topic-nfts', 'bch_getAddresses')
    expect(walletKit.responses[0]!.response.result).toEqual(['bitcoincash:qnfts'])
  })

  it('ends a session no wallet is recorded for', async () => {
    walletKit.addSession('topic-unowned', 'bitcoincash:qold')
    const { walletconnectStore } = await openWithSessions()
    await new Promise(resolve => setTimeout(resolve))
    expect(walletKit.disconnected).toEqual(['topic-unowned'])
    expect(Object.keys(walletconnectStore.activeSessions ?? {})).toEqual(['topic-defi'])
  })

  it('ends the sessions of a deleted wallet on every network, with their record and auto-approve', async () => {
    const { walletconnectStore } = await openWithSessions()
    walletKit.addSession('topic-nfts-chipnet', 'bchtest:qnfts')
    localStorageMock.setItem('walletConnectSessionWallets', JSON.stringify({ ...savedSessionWallets(), 'topic-nfts-chipnet': 'chipnet:nfts' }))

    await walletconnectStore.endSessionsOfWallet('nfts')
    expect(walletKit.disconnected.sort()).toEqual(['topic-nfts', 'topic-nfts-chipnet'])
    expect(savedSessionWallets()).toEqual({ 'topic-defi': 'mainnet:defi' })
    expect(mockClearAutoApproveState).toHaveBeenCalledWith('topic-nfts')
    expect(mockClearAutoApproveState).toHaveBeenCalledWith('topic-nfts-chipnet')
  })

  it('ends the sessions of one network only when a wallet leaves that network', async () => {
    const { walletconnectStore } = await openWithSessions()
    walletKit.addSession('topic-defi-chipnet', 'bchtest:qdefi')
    localStorageMock.setItem('walletConnectSessionWallets', JSON.stringify({ ...savedSessionWallets(), 'topic-defi-chipnet': 'chipnet:defi' }))

    await walletconnectStore.endSessionsOfWallet('defi', 'chipnet')
    expect(walletKit.disconnected).toEqual(['topic-defi-chipnet'])
    expect(Object.keys(walletconnectStore.activeSessions ?? {})).toEqual(['topic-defi'])
  })
})
