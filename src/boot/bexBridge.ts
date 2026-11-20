import { defineBoot } from '#q-app'
import { watch } from 'vue'
import { BEX_PROVIDER_STATE_KEY, chainIdOf, type BexProviderState } from 'src/utils/bex/permissions'
import type { BexCancelMessage, BexReadyMessage, BexRequestMessage, BexResponseMessage } from 'src/interfaces/bex'

// The extension page is the wallet host. It keeps one port to the service worker, which routes
// WC2 JSON-RPC requests from the content-script provider here and carries the answers back. It
// sends the sites no events itself: it stores which wallet is open, and the worker tells each site
// what that changes for it. The store is imported dynamically: its module graph reads the settings
// store at import time, which needs Pinia to be installed before the boot file runs.
export default defineBoot(async () => {
  if (!import.meta.env.QUASAR_BEX_MODE) return

  const { useBexStore, BexRpcError } = await import('src/stores/bexStore')
  const { useStore } = await import('src/stores/store')
  const bexStore = useBexStore()
  const mainStore = useStore()

  // Only the approval window the worker opens is a popup window, and the worker closes it once the
  // queue drains. The toolbar popup and a tab are the user's own and stay open.
  let isPopupPage = false
  try {
    isPopupPage = (await chrome.windows.getCurrent()).type === 'popup'
  } catch {
    // default to keeping the page open
  }

  let port: chrome.runtime.Port | null = null
  // The requests being handled: a restarted worker resends one, which its running handler answers,
  // and a cancel from the worker aborts it
  const inFlight = new Map<number, AbortController>()
  // answers made while the worker restarts, which go out on the next port before anything else
  const unsent: BexResponseMessage[] = []

  // Written once a wallet is open, and again for every other one opened: without a wallet there
  // is nothing to tell the sites, and an empty state would disconnect them all while it loads.
  watch(() => bexStore.activeWalletId, (walletId) => {
    if (!walletId) return
    const network = mainStore.network
    const state: BexProviderState = { chainId: chainIdOf(network), network, walletId }
    chrome.storage.local.set({ [BEX_PROVIDER_STATE_KEY]: state }).catch(() => {})
  }, { immediate: true })

  // On the current port rather than the one the request came on, which a restart replaces
  function postResponse(response: BexResponseMessage) {
    if (!port) {
      unsent.push(response)
      return
    }
    try {
      port.postMessage(response)
    } catch {
      unsent.push(response)
    }
  }

  function connect() {
    port = chrome.runtime.connect({ name: 'cashonize-app' })
    const connectedPort = port

    connectedPort.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: string }
      if (typed.type === 'close') {
        window.close()
        return
      }
      if (typed.type === 'cancel') {
        inFlight.get((message as BexCancelMessage).internalRequestId)?.abort()
        return
      }

      const request = message as BexRequestMessage
      if (request?.type !== 'request' || request.message?.jsonrpc !== '2.0') return
      if (typeof request.message.method !== 'string') return
      if (inFlight.has(request.internalRequestId)) return
      const controller = new AbortController()
      inFlight.set(request.internalRequestId, controller)

      void bexStore.handleRequest({
        origin: request.origin,
        method: request.message.method,
        params: request.message.params,
      }, controller.signal).then(
        (result) => postResponse({
          type: 'response',
          internalRequestId: request.internalRequestId,
          result,
        } satisfies BexResponseMessage),
        (error: unknown) => postResponse({
          type: 'response',
          internalRequestId: request.internalRequestId,
          error: {
            code: error instanceof BexRpcError ? error.code : 5000,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        } satisfies BexResponseMessage),
      ).finally(() => {
        inFlight.delete(request.internalRequestId)
      })
    })

    connectedPort.onDisconnect.addListener(() => {
      if (port === connectedPort) port = null
      // a reloaded extension or a restarted worker drops the port
      setTimeout(connect, 1000)
    })

    // Answers first, so the worker settles their requests before dispatching again. It dispatches
    // a queued request only once the page is listening, and learns here whether closing the page
    // after the queue drains is safe.
    for (const response of unsent.splice(0)) postResponse(response)
    connectedPort.postMessage({ type: 'ready', isPopup: isPopupPage } satisfies BexReadyMessage)
  }

  connect()
})
