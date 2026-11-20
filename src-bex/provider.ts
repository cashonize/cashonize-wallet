import type { BexEventName, Wc2Request, Wc2Response } from '../src/interfaces/bex'
import { toWireJson } from '../src/utils/bex/wireJson'
import { mergeDappMetadata, type DappPageMetadata } from '../src/utils/bex/metadata'

// Runs in the page's MAIN world at document_start, before the dApp's scripts. It carries WC2-BCH
// JSON-RPC without the WalletConnect relay: send() resolves with the response envelope, request()
// with its result. It keeps EIP-1193-style state and events, and it is a WC2-BCH connector
// (IConnector in @bch-wc2/interfaces), the interface dApps code against for WalletConnect.
const CHANNEL = 'cashonize'
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000

interface ProviderRequest {
  method: string
  params?: unknown
}

type Listener = (...args: unknown[]) => void

interface PendingRequest {
  callerId: number
  resolve: (response: Wc2Response) => void
  timer: ReturnType<typeof setTimeout>
}

class ProviderRpcError extends Error {
  code: number
  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ProviderRpcError'
    this.code = code
    this.data = data
  }
}

const pending = new Map<number, PendingRequest>()
const listeners = new Map<string, Set<Listener>>()
// The ids on the wire are the provider's own: send()'s ids are the dApp's and may repeat, and
// starting at a random base keeps a previous page in this tab from matching an answer meant here
let nextWireId = crypto.getRandomValues(new Uint32Array(1))[0]! * 2 ** 20
let nextRequestId = 1
let chainId: string | undefined
let networkVersion: string | undefined
let accounts: string[] = []
// connect is the dApp's once-per-page signal; the worker sends it again after each restart
let connectAnnounced = false

function networkFromChainId(nextChainId: string): string | undefined {
  const [, network] = nextChainId.split(':')
  return network
}

function emit(event: string, data: unknown) {
  for (const listener of listeners.get(event) ?? []) listener(data)
}

// The worker sends the full state again after each of its restarts; the dApp hears only changes.
// A site that loses its accounts is disconnected, whoever ended it: the dApp, the user in the
// wallet, or a switch to a wallet the site is not connected to.
function setAccounts(next: string[]) {
  if (next.length === accounts.length && next.every((account, index) => account === accounts[index])) return
  const wasConnected = accounts.length > 0
  accounts = next
  emit('accountsChanged', next)
  emit('addressChanged', next[0])
  if (wasConnected && !next.length) emit('disconnect', { code: 4900, message: 'The site is no longer connected' })
}

function setChain(nextChainId: string) {
  if (nextChainId === chainId) return
  const known = chainId !== undefined
  chainId = nextChainId
  networkVersion = networkFromChainId(nextChainId)
  if (known) emit('chainChanged', nextChainId)
}

function stringsOf(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : []
}

// A dApp's declared metadata is shown field by field; the page fills what it leaves out (title,
// meta description, declared favicon), as an injected EVM wallet presents a site. Cosmetic; the
// attested origin stays the identity. The latest metadata a dApp declared is reused for later
// calls that declare none.
let declaredMetadata: unknown

function pageMetadata(): DappPageMetadata {
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content')
    ?? document.querySelector('meta[property="og:description"]')?.getAttribute('content')
    ?? ''
  const iconHref = document.querySelector('link[rel~="icon"]')?.getAttribute('href')
  const icons: string[] = []
  if (iconHref) {
    try {
      icons.push(new URL(iconHref, document.baseURI).href)
    } catch {
      // an unusable href leaves the icon out
    }
  }
  return {
    name: document.title.trim().slice(0, 64) || location.host || 'dApp',
    ...(description.trim() ? { description: description.trim().slice(0, 256) } : {}),
    ...(icons.length ? { icons } : {}),
  }
}

// dApps often name their icon relative to the page; the wallet only loads absolute URLs.
function resolveIcon(icon: unknown): unknown {
  if (typeof icon !== 'string' || !icon.trim()) return icon
  try {
    return new URL(icon, document.baseURI).href
  } catch {
    return icon
  }
}

function resolveIcons(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata
  const record = metadata as Record<string, unknown>
  return {
    ...record,
    ...(Array.isArray(record.icons) ? { icons: record.icons.map(resolveIcon) } : {}),
    // WizardConnect's singular icon
    ...(record.icon !== undefined ? { icon: resolveIcon(record.icon) } : {}),
  }
}

function paramsWithMetadata(method: string, params: unknown): unknown {
  if (method !== 'bch_requestAccounts' && method !== 'bch_connect') return params
  const plain = params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : undefined
  const supplied = resolveIcons(plain?.dappMetadata)
  if (supplied !== undefined && supplied !== null) declaredMetadata = supplied
  return { ...plain, dappMetadata: mergeDappMetadata(declaredMetadata, pageMetadata()) }
}

function handleProviderEvent(event: BexEventName, data: unknown) {
  if (event === 'connect') {
    // The provider is available on the chain; this does not authorize an account.
    const nextChainId = (data as { chainId?: unknown } | undefined)?.chainId
    if (typeof nextChainId !== 'string') return
    setChain(nextChainId)
    if (connectAnnounced) return
    connectAnnounced = true
    emit('connect', { chainId: nextChainId })
  } else if (event === 'chainChanged') {
    if (typeof data === 'string') setChain(data)
  } else if (event === 'accountsChanged') {
    setAccounts(stringsOf(data))
  } else if (event === 'disconnect') {
    setAccounts([])
  }
}

function send(message: Wc2Request): Promise<Wc2Response> {
  if (message?.jsonrpc !== '2.0' || typeof message.id !== 'number' || typeof message.method !== 'string') {
    return Promise.reject(new TypeError('Invalid WC2 request'))
  }
  let params: unknown
  try {
    params = paramsWithMetadata(message.method, toWireJson(message.params))
  } catch {
    return Promise.reject(new TypeError('Request params must be JSON, apart from Uint8Array and bigint values'))
  }

  const wireId = nextWireId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(wireId)
      resolve({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: 4000, message: 'Cashonize request timed out' },
      })
    }, REQUEST_TIMEOUT_MS)
    pending.set(wireId, { callerId: message.id, resolve, timer })
    window.postMessage({ channel: CHANNEL, type: 'request', message: { ...message, id: wireId, params } }, window.location.origin)
  })
}

const provider = {
  isCashonize: true,
  isBitcoinCash: true,

  send,

  async request({ method, params }: ProviderRequest): Promise<unknown> {
    const id = nextRequestId++
    const response = await send({ jsonrpc: '2.0', id, method, params })
    if (response.error) {
      throw new ProviderRpcError(response.error.code, response.error.message, response.error.data)
    }

    // The worker tells the page of account changes too; this keeps the state right if that event
    // is lost, and the dApp still hears of a change only once.
    const result = response.result
    if (['bch_requestAccounts', 'bch_connect', 'bch_getAddresses', 'bch_getAccounts'].includes(method)) {
      setAccounts(stringsOf(result))
    } else if (method === 'bch_disconnect') {
      setAccounts([])
    } else if (method === 'bch_getNetwork' && result && typeof result === 'object') {
      const network = result as { chainId?: unknown }
      if (typeof network.chainId === 'string') setChain(network.chainId)
    }
    return result
  },

  on(event: string, listener: Listener) {
    const eventListeners = listeners.get(event) ?? new Set<Listener>()
    eventListeners.add(listener)
    listeners.set(event, eventListeners)
    return provider
  },

  removeListener(event: string, listener: Listener) {
    listeners.get(event)?.delete(listener)
    return provider
  },

  get chainId() {
    return chainId
  },

  get networkVersion() {
    return networkVersion
  },

  get selectedAddress() {
    return accounts[0]
  },

  isConnected() {
    return accounts.length > 0
  },

  enable() {
    return provider.request({ method: 'bch_requestAccounts', params: {} })
  },

  // The WC2-BCH connector interface. As with the reference WalletConnect connector, a refused or
  // failed call resolves to undefined, or connect() to nothing; request() gives the error.
  async address(): Promise<string | undefined> {
    try {
      const addresses = await provider.request({ method: 'bch_getAddresses', params: {} })
      return stringsOf(addresses)[0]
    } catch {
      return undefined
    }
  },

  signTransaction(options: unknown): Promise<unknown> {
    return provider.request({ method: 'bch_signTransaction', params: options }).catch(() => undefined)
  },

  signMessage(options: unknown): Promise<unknown> {
    return provider.request({ method: 'bch_signMessage', params: options }).catch(() => undefined)
  },

  // a chainId makes a wallet on another network refuse, as a WalletConnect proposal's chains do
  async connect(options?: { chainId?: string; dappMetadata?: unknown }): Promise<void> {
    const params: Record<string, unknown> = {}
    if (options?.chainId !== undefined) params.chainId = options.chainId
    if (options?.dappMetadata !== undefined) params.dappMetadata = options.dappMetadata
    await provider.request({ method: 'bch_requestAccounts', params }).catch(() => undefined)
  },

  // asks the wallet rather than trusting the state, which a page that just loaded may not have yet
  async connected(): Promise<boolean> {
    return (await provider.address()) !== undefined
  },

  async disconnect(): Promise<void> {
    await provider.request({ method: 'bch_disconnect', params: {} }).catch(() => undefined)
  },
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as {
    channel?: string
    type?: string
    message?: Wc2Response
    event?: BexEventName
    data?: unknown
  }
  if (data?.channel !== CHANNEL) return

  if (data.type === 'event' && data.event) {
    handleProviderEvent(data.event, data.data)
    return
  }

  if (data.type !== 'response' || !data.message) return
  const response = data.message
  if (response.jsonrpc !== '2.0' || typeof response.id !== 'number') return
  const entry = pending.get(response.id)
  if (!entry) return
  pending.delete(response.id)
  clearTimeout(entry.timer)
  entry.resolve({ ...response, id: entry.callerId })
})

// The generic name is claimed only when no other wallet holds it; discovery below is how several
// BCH wallets coexist.
if (!('cashonize' in window)) {
  Object.defineProperty(window, 'cashonize', {
    value: provider,
    configurable: false,
    writable: false,
  })
}

if (!('bitcoincash' in window)) {
  Object.defineProperty(window, 'bitcoincash', {
    value: provider,
    configurable: false,
    writable: false,
  })
}

// BCH counterpart of EIP-6963. A dApp dispatches bitcoincash:requestProvider; each wallet answers
// with bitcoincash:announceProvider and an info block, so several BCH wallets can coexist even
// though only one can own the window.bitcoincash alias.
const providerInfo = Object.freeze({
  uuid: crypto.randomUUID(),
  name: 'Cashonize',
  icon: `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
      + '<circle cx="64" cy="64" r="60" fill="#16b98a"/>'
      + '<text x="64" y="88" font-size="76" text-anchor="middle" fill="white" font-family="Arial, sans-serif">₿</text>'
      + '</svg>',
  )}`,
  rdns: 'com.cashonize.wallet',
})

const announceDetail = Object.freeze({ info: providerInfo, provider })

function announceProvider() {
  window.dispatchEvent(new CustomEvent('bitcoincash:announceProvider', {
    detail: announceDetail,
  }))
}

window.addEventListener('bitcoincash:requestProvider', announceProvider)
// Announce once after the globals exist; a dApp that loads later asks again.
announceProvider()
