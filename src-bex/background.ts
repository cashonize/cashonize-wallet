// Quasar's BEX worker module, for what it does in a dev build: serve the extension pages from the
// dev server and reload the extension on changes. Its bridge is not started, see answerQuasarBridge.
import '#q-app/bex/background'
import type {
  BexCancelMessage,
  BexCloseMessage,
  BexEventMessage,
  BexEventName,
  BexReadyMessage,
  BexRequestMessage,
  BexResponseMessage,
  BexTransportRequest,
  BexTransportResponse,
  Wc2Error,
  Wc2Request,
  Wc2Response,
} from '../src/interfaces/bex'
import {
  BEX_PERMISSION_PREFIX,
  BEX_PROVIDER_STATE_KEY,
  changedAccounts,
  isWebOrigin,
  itemsBefore,
  normalizePermission,
  normalizeProviderState,
  permissionKey,
  storageView,
  visibleAccounts,
} from '../src/utils/bex/permissions'
import { admissionError, BEX_QUEUE_KEY, CONNECT_METHODS, normalizeQueue, type BexQueuedRequest } from '../src/utils/bex/queue'
import { approvalPopupBounds } from '../src/utils/bex/popupBounds'

// Content scripts run inside web pages, where a compromised renderer can run code in their world.
// The permissions and the provider state are for the extension's own pages only. Chrome restricts
// storage.local from 140 on, the manifest's minimum; where it cannot, no request is served.
const storageLocked = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .then(() => true, () => false)

// The service worker routes dApp requests to the extension page that hosts the wallet. It never
// sees keys and never signs; the app page shows the approval and returns the result.
const APP_PORT = 'cashonize-app'
const CONTENT_PORT = 'cashonize-content'
const QUASAR_BRIDGE_PORT = 'app'
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin
const DEFAULT_CHAIN_ID = 'bch:bitcoincash'
// WalletConnect's code for a request the user or the dApp withdrew
const USER_REJECTED = 5000

const appPorts = new Set<chrome.runtime.Port>()
// the app ports of approval windows, which close once the queue drains
const popupPorts = new Set<chrome.runtime.Port>()
const contentPorts = new Set<chrome.runtime.Port>()

// Interactive requests wait in arrival order. Only the head is sent to the wallet page, so a
// burst of requests produces dialogs one after another instead of stacked on top of each other.
// Kept in storage.session, trusted-only by default: the sequence survives a wallet-page reload and
// a worker restart, but not a browser restart, which closes the pages that asked.
const queue: BexQueuedRequest[] = []
const requestTimers = new Map<number, ReturnType<typeof setTimeout>>()
const sourcePorts = new Map<number, chrome.runtime.Port>()
let dispatchedId: number | null = null
let dispatchedPort: chrome.runtime.Port | null = null

// Unique across worker restarts as well: the wallet page skips a redispatch of the id on screen,
// and the persisted queue is ordered by it
let nextInternalRequestId = Date.now()
let openingAppPage = false
// a watchdog for a window that failed to load; two tries, then the request timeout
let appPageAttempts = 0
const MAX_APP_PAGE_ATTEMPTS = 2
let closeTimer: ReturnType<typeof setTimeout> | null = null
let persistChain: Promise<void> = Promise.resolve()
// When the user last refused a site's connect request: a site that asks again at once is answered
// without a prompt for a while, so it cannot hold the wallet window open with requests
const connectRefusedAt = new Map<string, number>()
const CONNECT_COOLDOWN_MS = 10_000

type Outcome = { result?: unknown; error?: Wc2Error }

function postEvent(port: chrome.runtime.Port, event: BexEventName, data: unknown) {
  try {
    port.postMessage({ type: 'event', event, data } satisfies BexEventMessage)
  } catch {
    // the page went away in between
  }
}

function sitePorts(origin?: string): chrome.runtime.Port[] {
  return [...contentPorts].filter(port =>
    isWebOrigin(port.sender?.origin) && (origin === undefined || port.sender?.origin === origin))
}

// Provider events come only from here, derived from the storage: a site's accounts change when its
// permission does, or when the wallet page opens another wallet; the chain when its network does.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  const relevant = Object.keys(changes)
    .some(key => key === BEX_PROVIDER_STATE_KEY || key.startsWith(BEX_PERMISSION_PREFIX))
  if (relevant) void announceStorageChange(changes)
})

async function announceStorageChange(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) {
  let after: Record<string, unknown>
  try {
    after = await chrome.storage.local.get(null)
  } catch {
    return
  }
  const previous = storageView(itemsBefore(after, changes))
  const next = storageView(after)
  if (next.state && next.state.chainId !== previous.state?.chainId) {
    for (const port of sitePorts()) postEvent(port, 'chainChanged', next.state.chainId)
  }
  for (const { origin, accounts } of changedAccounts(previous, next)) {
    for (const port of sitePorts(origin)) postEvent(port, 'accountsChanged', accounts)
  }
}

async function readSite(origin: string) {
  const stored = await chrome.storage.local.get([BEX_PROVIDER_STATE_KEY, permissionKey(origin)])
  const state = normalizeProviderState(stored[BEX_PROVIDER_STATE_KEY])
  const permission = normalizePermission(stored[permissionKey(origin)])
  return { state, accounts: visibleAccounts(permission, state) }
}

const APPROVAL_POPUP_WIDTH = 400
const APPROVAL_POPUP_HEIGHT = 720
const APPROVAL_POPUP_MARGIN = 16

async function ensureAppPage() {
  if (appPorts.size > 0 || openingAppPage || appPageAttempts >= MAX_APP_PAGE_ATTEMPTS) return
  openingAppPage = true
  appPageAttempts++

  // Float the approval window at the top-right of the active browser window. Chromium otherwise
  // places a new popup at the top-left of the screen.
  let bounds: { left: number; top: number } | undefined
  try {
    const current = await chrome.windows.getLastFocused()
    bounds = approvalPopupBounds(current, APPROVAL_POPUP_WIDTH, APPROVAL_POPUP_MARGIN)
  } catch {
    // fall back to Chromium's default placement
  }

  try {
    const created = await chrome.windows.create({
      type: 'popup',
      url: chrome.runtime.getURL('www/index.html'),
      width: APPROVAL_POPUP_WIDTH,
      height: APPROVAL_POPUP_HEIGHT,
      focused: true,
    })
    // Move after creation: some window managers reject explicit bounds on a new popup.
    if (bounds && created.id !== undefined) {
      await chrome.windows.update(created.id, { left: bounds.left, top: bounds.top })
    }
  } catch {
    // the request times out instead
  }
  // the page connects while it loads; until then a burst of requests opens no second window
  setTimeout(() => {
    openingAppPage = false
    // one more try if the window failed to load, while requests are still waiting
    if (queue.length > 0 && appPorts.size === 0 && appPageAttempts < MAX_APP_PAGE_ATTEMPTS) dispatchNext()
  }, 2000)
}

function closeAppPage(port: chrome.runtime.Port) {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    try {
      port.postMessage({ type: 'close' } satisfies BexCloseMessage)
    } catch {
      // The page already closed itself.
    }
  }, 100)
}

// A request arriving while the close is pending keeps the page alive for its dialog.
function cancelScheduledClose() {
  if (!closeTimer) return
  clearTimeout(closeTimer)
  closeTimer = null
}

// Aborts a request the wallet page may still be handling: its dialog closes, and a handler not at
// its dialog yet never shows or signs it
function cancelDialog(internalRequestId: number) {
  for (const appPort of appPorts) {
    try {
      appPort.postMessage({ type: 'cancel', internalRequestId } satisfies BexCancelMessage)
    } catch {
      // a port that closed in between
    }
  }
}

function persistQueue(): Promise<void> {
  const snapshot = queue.map(entry => ({ ...entry }))
  persistChain = persistChain.then(async () => {
    try {
      await chrome.storage.session.set({ [BEX_QUEUE_KEY]: snapshot })
    } catch {
      // Keep the in-memory queue; the next write stores the then-current sequence.
    }
  })
  return persistChain
}

function queueIndex(internalRequestId: number): number {
  return queue.findIndex(entry => entry.internalRequestId === internalRequestId)
}

function clearRequestTimer(internalRequestId: number) {
  const timer = requestTimers.get(internalRequestId)
  if (timer) clearTimeout(timer)
  requestTimers.delete(internalRequestId)
}

function scheduleTimeout(entry: BexQueuedRequest) {
  clearRequestTimer(entry.internalRequestId)
  const remaining = entry.createdAt + REQUEST_TIMEOUT_MS - Date.now()
  requestTimers.set(entry.internalRequestId, setTimeout(() => {
    void failRequest(entry.internalRequestId, { code: 4000, message: 'Cashonize request timed out' })
  }, Math.max(0, remaining)))
}

function contentPortFor(entry: BexQueuedRequest): chrome.runtime.Port | undefined {
  const source = sourcePorts.get(entry.internalRequestId)
  if (source) return source

  // After a worker restart the source port is gone, and the tab that sent the request is back on
  // a new one. Another tab of the same site waits on ids of its own, so it never gets the answer.
  if (entry.tabId === undefined) return undefined
  return [...contentPorts].find(port => port.sender?.origin === entry.origin && port.sender?.tab?.id === entry.tabId)
}

function respond(port: chrome.runtime.Port, id: number, outcome: Outcome) {
  const response: Wc2Response = {
    jsonrpc: '2.0',
    id,
    ...(outcome.error ? { error: outcome.error } : { result: outcome.result }),
  }
  try {
    port.postMessage({ type: 'response', message: response } satisfies BexTransportResponse)
  } catch {
    // the dApp tab closed in between
  }
}

function deliverResponse(entry: BexQueuedRequest, outcome: Outcome) {
  const port = contentPortFor(entry)
  if (port) respond(port, entry.message.id, outcome)
}

async function settleRequest(internalRequestId: number, outcome: Outcome): Promise<BexQueuedRequest | undefined> {
  const index = queueIndex(internalRequestId)
  if (index === -1) return undefined
  const wasHead = index === 0
  const entry = queue.splice(index, 1)[0]!
  clearRequestTimer(internalRequestId)

  // Store the shorter queue before the answer leaves: a worker restart after this point must not
  // present the finished request again.
  await persistQueue()
  deliverResponse(entry, outcome)
  sourcePorts.delete(internalRequestId)

  if (wasHead) {
    dispatchedId = null
    dispatchedPort = null
  }
  return entry
}

async function failRequest(internalRequestId: number, error: Wc2Error) {
  const wasHead = queue[0]?.internalRequestId === internalRequestId
  const headPort = wasHead ? dispatchedPort : null
  const entry = await settleRequest(internalRequestId, { error })
  if (!entry) return

  cancelDialog(internalRequestId)
  if (queue.length > 0) {
    dispatchNext()
  } else if (headPort && popupPorts.has(headPort)) {
    closeAppPage(headPort)
  }
}

function dispatchNext() {
  if (queue.length === 0) return
  // the newest wallet page, which loaded its data last: the toolbar popup while it is open
  const appPort = [...appPorts].at(-1)
  if (!appPort) {
    void ensureAppPage()
    return
  }

  const entry = queue[0]
  if (!entry) return
  if (dispatchedId === entry.internalRequestId && dispatchedPort === appPort) return
  cancelScheduledClose()
  dispatchedId = entry.internalRequestId
  dispatchedPort = appPort
  const message: BexRequestMessage = {
    type: 'request',
    internalRequestId: entry.internalRequestId,
    origin: entry.origin,
    message: entry.message,
  }
  try {
    appPort.postMessage(message)
  } catch {
    // The port closed; its disconnect handler clears the dispatch and the next page takes over.
    dispatchedId = null
    dispatchedPort = null
    return
  }
  void bringToFront(appPort)
}

// A wallet page in a background tab or window would hold the request unseen. The toolbar popup has
// no tab, and is in front whenever it is open.
async function bringToFront(appPort: chrome.runtime.Port) {
  const tab = appPort.sender?.tab
  if (tab?.id === undefined) return
  try {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  } catch {
    // the page closed in between
  }
}

async function handleAppResponse(response: BexResponseMessage, appPort: chrome.runtime.Port) {
  if (response?.type !== 'response') return
  // an answer arriving while a restarted worker restores the queue belongs to a restored request
  await queueReady
  const outcome = response.error ? { error: response.error } : { result: response.result }
  const entry = await settleRequest(response.internalRequestId, outcome)
  if (!entry) return
  if (CONNECT_METHODS.has(entry.message.method) && response.error?.code === USER_REJECTED) {
    connectRefusedAt.set(entry.origin, Date.now())
  }

  if (queue.length > 0) {
    dispatchNext()
    return
  }
  if (popupPorts.has(appPort)) closeAppPage(appPort)
}

async function restoreQueue() {
  try {
    const stored = await chrome.storage.session.get(BEX_QUEUE_KEY)
    for (const entry of normalizeQueue(stored[BEX_QUEUE_KEY])) {
      if (queueIndex(entry.internalRequestId) !== -1) continue
      queue.push(entry)
      nextInternalRequestId = Math.max(nextInternalRequestId, entry.internalRequestId + 1)
      scheduleTimeout(entry)
    }
  } catch {
    // Start with an empty queue when storage cannot be read.
  }
  // Do not open a window here: the wallet page (if one is still open) reconnects after a worker
  // restart and asks for the queue with its ready message.
}

const queueReady = restoreQueue()

async function enqueueRequest(port: chrome.runtime.Port, origin: string, wc2: Wc2Request) {
  if (queue.length === 0) appPageAttempts = 0
  const entry: BexQueuedRequest = {
    internalRequestId: nextInternalRequestId++,
    origin,
    ...(port.sender?.tab?.id !== undefined ? { tabId: port.sender.tab.id } : {}),
    message: wc2,
    createdAt: Date.now(),
  }
  queue.push(entry)
  sourcePorts.set(entry.internalRequestId, port)
  scheduleTimeout(entry)
  await persistQueue()
  dispatchNext()
}

async function cancelQueuedRequests(origin: string): Promise<number> {
  const cancelled = queue.filter(entry => entry.origin === origin)
  if (cancelled.length === 0) return 0
  // scoped to the site, as a WalletConnect cancellation is to its session
  const headCancelled = queue[0]?.origin === origin
  const popupPort = headCancelled && dispatchedPort && popupPorts.has(dispatchedPort) ? dispatchedPort : null

  // Every waiting dApp request gets its answer too; otherwise those promises hang until the
  // provider's own timeout.
  for (const entry of cancelled) {
    clearRequestTimer(entry.internalRequestId)
    deliverResponse(entry, { error: { code: USER_REJECTED, message: 'Request cancelled by the dApp' } })
    sourcePorts.delete(entry.internalRequestId)
    queue.splice(queue.indexOf(entry), 1)
    cancelDialog(entry.internalRequestId)
  }
  if (headCancelled) {
    dispatchedId = null
    dispatchedPort = null
  }
  await persistQueue()

  if (queue.length > 0 && dispatchedId === null) dispatchNext()
  if (popupPort && queue.length === 0) closeAppPage(popupPort)
  return cancelled.length
}

async function dropRequestsFromPort(port: chrome.runtime.Port) {
  const droppedIds = [...sourcePorts]
    .filter(([, source]) => source === port)
    .map(([internalRequestId]) => internalRequestId)
  if (!droppedIds.length) return

  let closePort: chrome.runtime.Port | null = null
  for (const internalRequestId of droppedIds) {
    const index = queueIndex(internalRequestId)
    if (index === -1) continue
    const wasHead = index === 0
    if (wasHead) {
      closePort = dispatchedPort && popupPorts.has(dispatchedPort) ? dispatchedPort : null
      dispatchedId = null
      dispatchedPort = null
    }
    queue.splice(index, 1)
    clearRequestTimer(internalRequestId)
    sourcePorts.delete(internalRequestId)
    cancelDialog(internalRequestId)
  }

  await persistQueue()
  if (queue.length > 0) dispatchNext()
  else if (closePort) closeAppPage(closePort)
}

// A page that opens, or comes back after a worker restart, gets the chain and its accounts; the
// page-side provider tells its dApp only of what changed.
async function restoreProviderState(port: chrome.runtime.Port, origin: string) {
  try {
    const { state, accounts } = await readSite(origin)
    postEvent(port, 'connect', { chainId: state?.chainId ?? DEFAULT_CHAIN_ID })
    postEvent(port, 'accountsChanged', accounts)
  } catch {
    // storage unavailable; the page can still ask
  }
}

async function handleContentRequest(port: chrome.runtime.Port, wc2: Wc2Request) {
  const origin = port.sender?.origin
  if (!isWebOrigin(origin)) {
    respond(port, wc2.id, { error: { code: 4100, message: 'Cashonize serves http(s) sites only' } })
    return
  }
  if (!(await storageLocked)) {
    respond(port, wc2.id, { error: { code: 4900, message: 'Cashonize needs Chrome 140 or later' } })
    return
  }
  // A worker restart restores the queue from storage; a cancel or a new request has to count the
  // restored entries too.
  await queueReady

  try {
    switch (wc2.method) {
      case 'bch_getAddresses':
      case 'bch_getAccounts': {
        const { accounts } = await readSite(origin)
        respond(port, wc2.id, { result: accounts })
        return
      }
      case 'bch_getNetwork': {
        // built field by field: the stored state also names the wallet, which is no site's business
        const { state } = await readSite(origin)
        respond(port, wc2.id, {
          result: { chainId: state?.chainId ?? DEFAULT_CHAIN_ID, network: state?.network ?? 'mainnet' },
        })
        return
      }
      case 'bch_disconnect':
        // the storage change tells the site's pages their accounts are gone, which their
        // providers announce as a disconnect
        await chrome.storage.local.remove(permissionKey(origin))
        respond(port, wc2.id, { result: null })
        return
      case 'bch_cancelPendingRequests': {
        const cancelledCount = await cancelQueuedRequests(origin)
        respond(port, wc2.id, { result: { cancelledCount } })
        return
      }
      case 'bch_requestAccounts':
      case 'bch_connect': {
        // A connected site asking again, as a dApp does on every load, needs no wallet page. It
        // keeps the metadata it was approved with: writing back the permission read here could
        // land after the user's revoke and undo it.
        const { state, accounts } = await readSite(origin)
        const chainId = (wc2.params as { chainId?: unknown } | undefined)?.chainId
        if (accounts.length && (chainId === undefined || chainId === state?.chainId)) {
          respond(port, wc2.id, { result: accounts })
          return
        }
        if (Date.now() - (connectRefusedAt.get(origin) ?? 0) < CONNECT_COOLDOWN_MS) {
          respond(port, wc2.id, { error: { code: USER_REJECTED, message: 'User rejected.' } })
          return
        }
        break
      }
      case 'bch_signMessage':
      case 'personal_sign':
      case 'bch_signTransaction': {
        // only a site connected to the open wallet asks for a signature; any other is answered
        // here, without bringing up the wallet window
        const { accounts } = await readSite(origin)
        if (!accounts.length) {
          respond(port, wc2.id, { error: { code: 4100, message: 'Unauthorized: call bch_requestAccounts first' } })
          return
        }
        break
      }
      default:
        respond(port, wc2.id, { error: { code: 1001, message: `Unsupported method ${wc2.method}` } })
        return
    }
  } catch (error) {
    respond(port, wc2.id, {
      error: { code: 5000, message: error instanceof Error ? error.message : 'Request failed' },
    })
    return
  }

  const refusal = admissionError(queue, origin, wc2)
  if (refusal) {
    respond(port, wc2.id, { error: refusal })
    return
  }
  await enqueueRequest(port, origin, wc2)
}

// Quasar's app entry holds every extension page's boot until the page's bridge hears from the
// worker. Quasar's worker side of it (createBridge) takes that port from content scripts too, and
// a second port by the page's name drops the page's own. Cashonize sends nothing over the bridge,
// so the worker answers the handshake itself, and only to the extension's pages.
function answerQuasarBridge(port: chrome.runtime.Port) {
  if (port.sender?.origin !== EXTENSION_ORIGIN) {
    port.disconnect()
    return
  }
  // the port list Quasar's own worker sends first
  port.postMessage({
    id: 0,
    from: 'background',
    to: QUASAR_BRIDGE_PORT,
    type: 'full',
    payload: { portList: ['background'] },
    messageType: 'event-send',
    messageProps: { event: '@quasar:ports' },
  })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === QUASAR_BRIDGE_PORT) {
    answerQuasarBridge(port)
    return
  }
  if (port.name === APP_PORT) {
    // Only the extension's own pages host the wallet. A content script runs in a web page, which a
    // compromised renderer controls, so asking for this port from there gets nothing.
    if (port.sender?.origin !== EXTENSION_ORIGIN) {
      port.disconnect()
      return
    }
    appPorts.add(port)
    // a wallet page is up, so the next one need not wait out ensureAppPage's guard
    openingAppPage = false
    appPageAttempts = 0

    port.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: string } | undefined
      if (typed?.type === 'ready') {
        if ((message as BexReadyMessage).isPopup === true) popupPorts.add(port)
        void queueReady.then(dispatchNext)
        return
      }
      void handleAppResponse(message as BexResponseMessage, port)
    })

    port.onDisconnect.addListener(() => {
      // The wallet popup closing is not a dApp disconnect: the stored state stays and so does the
      // queue, and the next request opens a new popup.
      appPorts.delete(port)
      popupPorts.delete(port)
      if (dispatchedPort === port) {
        dispatchedId = null
        dispatchedPort = null
      }
      // Another open wallet page (a tab next to the popup) can take over the queued request.
      if (appPorts.size > 0) dispatchNext()
    })

    return
  }

  if (port.name !== CONTENT_PORT) return

  contentPorts.add(port)
  const origin = port.sender?.origin
  if (isWebOrigin(origin)) void restoreProviderState(port, origin)

  port.onMessage.addListener((message: unknown) => {
    const request = message as BexTransportRequest
    if (request?.type !== 'request') return
    const wc2 = request.message
    if (!wc2 || wc2.jsonrpc !== '2.0' || typeof wc2.id !== 'number' || typeof wc2.method !== 'string') {
      respond(port, typeof wc2?.id === 'number' ? wc2.id : 0, { error: { code: -32600, message: 'Invalid WC2 request' } })
      return
    }

    void handleContentRequest(port, wc2)
  })

  port.onDisconnect.addListener(() => {
    contentPorts.delete(port)
    void dropRequestsFromPort(port)
  })
})
