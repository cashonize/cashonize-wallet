import type { BexEventMessage, BexTransportRequest, BexTransportResponse, Wc2Request, Wc2Response } from '../src/interfaces/bex'
import { MAX_QUEUED, MAX_REQUEST_BYTES } from '../src/utils/bex/queue'

// Runs in the isolated content-script world on the dApp page. It is only a relay: the page-side
// provider posts a WC2 JSON-RPC request, this forwards it to the extension's service worker, and
// the worker's JSON-RPC response is posted back to the page. The worker attests the page origin.
const CHANNEL = 'cashonize'
const RECONNECT_DELAY_MS = 1000
// An update or reload of the extension leaves this script behind; the page needs a reload to get
// the new one, and until then its requests get this answer rather than none
const RELOAD_ERROR = { code: 4900, message: 'Cashonize was updated: reload the page to reconnect' }
// The worker's own admission limit, applied here while it is unreachable, so a page cannot fill
// the extension's memory with requests during a restart
const BUSY_ERROR = { code: -32005, message: 'Too many pending requests' }

let port: chrome.runtime.Port | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let orphaned = false
// Requests made while the worker restarts (it stops after 30 s idle) wait here for the next port
const outbox: BexTransportRequest[] = []

function postToPage(message: Record<string, unknown>) {
  window.postMessage({ channel: CHANNEL, ...message }, window.location.origin)
}

function answerPage(response: Wc2Response) {
  postToPage({ type: 'response', message: response })
}

function scheduleReconnect() {
  port = null
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_DELAY_MS)
}

function refuse(message: BexTransportRequest, error = RELOAD_ERROR) {
  answerPage({ jsonrpc: '2.0', id: message.message.id, error })
}

function orphan() {
  orphaned = true
  port = null
  for (const message of outbox.splice(0)) refuse(message)
  postToPage({ type: 'event', event: 'disconnect', data: RELOAD_ERROR })
}

function queueForReconnect(message: BexTransportRequest) {
  if (outbox.length >= MAX_QUEUED) {
    refuse(message, BUSY_ERROR)
    return
  }
  outbox.push(message)
}

function deliver(message: BexTransportRequest) {
  if (orphaned) {
    refuse(message)
    return
  }
  if (!port) {
    queueForReconnect(message)
    return
  }
  try {
    port.postMessage(message)
  } catch {
    // The worker went away before onDisconnect said so; the message is valid JSON within the size
    // limit (handlePageMessage checks), so it goes out again on the next port
    queueForReconnect(message)
    scheduleReconnect()
  }
}

function handlePageMessage(event: MessageEvent) {
  if (event.source !== window) return
  const data = event.data as { channel?: string; type?: string; message?: Wc2Request }
  if (data?.channel !== CHANNEL || data.type !== 'request') return
  const wc2 = data.message
  if (!wc2 || wc2.jsonrpc !== '2.0' || typeof wc2.id !== 'number' || typeof wc2.method !== 'string') return

  // The worker receives JSON, which the provider makes of a dApp's params; a page posting here
  // directly gets an answer for params that are not JSON or too large, rather than none
  let serialized: string
  try {
    serialized = JSON.stringify(wc2)
  } catch {
    answerPage({
      jsonrpc: '2.0',
      id: wc2.id,
      error: { code: -32602, message: 'Request params must be JSON' },
    })
    return
  }
  if (serialized.length > MAX_REQUEST_BYTES) {
    answerPage({ jsonrpc: '2.0', id: wc2.id, error: { code: -32005, message: 'Request too large' } })
    return
  }
  deliver({ type: 'request', message: JSON.parse(serialized) as Wc2Request })
}

function connect() {
  let connected: chrome.runtime.Port
  try {
    connected = chrome.runtime.connect({ name: 'cashonize-content' })
  } catch {
    // the extension context is gone: updated, reloaded or removed
    orphan()
    return
  }
  port = connected

  connected.onMessage.addListener((message: unknown) => {
    const data = message as BexTransportResponse | BexEventMessage
    if (data?.type === 'event') {
      postToPage({ type: 'event', event: data.event, data: data.data })
      return
    }
    if (data?.type !== 'response' || !data.message) return
    postToPage({ type: 'response', message: data.message })
  })

  // The extension page or worker can go away (reload, update, idle stop); reconnect so the next
  // request from the page still reaches the wallet.
  connected.onDisconnect.addListener(() => {
    if (port === connected) scheduleReconnect()
  })

  for (const message of outbox.splice(0)) deliver(message)
}

window.addEventListener('message', handlePageMessage)
connect()
