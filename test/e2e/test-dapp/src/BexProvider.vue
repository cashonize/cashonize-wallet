<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { txFixture } from './fixtures'

interface Wc2Response {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface CashonizeProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  send(message: { jsonrpc: '2.0'; id: number; method: string; params?: unknown }): Promise<Wc2Response>
  on(event: string, listener: (data: unknown) => void): CashonizeProvider
  isConnected(): boolean
  enable(): Promise<unknown>
  readonly chainId?: string
  readonly networkVersion?: string
  readonly selectedAddress?: string
}

interface BchProviderDetail {
  info: {
    uuid: string
    name: string
    icon: string
    rdns: string
  }
  provider: CashonizeProvider
}

declare global {
  interface Window {
    cashonize?: CashonizeProvider
  }
}

const available = ref(false)
const busy = ref(false)
const response = ref('')
const jsonrpcResponse = ref('')
const chainId = ref('')
const networkVersion = ref('')
const selectedAddress = ref('')
const connected = ref(false)
const events = ref<string[]>([])
const discovered = ref<BchProviderDetail[]>([])

function onAnnounce(event: Event) {
  const detail = (event as CustomEvent<BchProviderDetail>).detail
  if (!detail?.info?.uuid) return
  if (discovered.value.some(provider => provider.info.uuid === detail.info.uuid)) return
  discovered.value.push(detail)
}

function refreshState() {
  if (!window.cashonize) return
  chainId.value = window.cashonize.chainId ?? ''
  networkVersion.value = window.cashonize.networkVersion ?? ''
  selectedAddress.value = window.cashonize.selectedAddress ?? ''
  connected.value = window.cashonize.isConnected()
}

onMounted(() => {
  available.value = typeof window.cashonize?.request === 'function'
  window.addEventListener('bitcoincash:announceProvider', onAnnounce)
  window.dispatchEvent(new Event('bitcoincash:requestProvider'))
  refreshState()
  window.cashonize?.on('connect', (data) => {
    events.value.push(`connect:${JSON.stringify(data)}`)
    refreshState()
  })
  window.cashonize?.on('accountsChanged', (data) => {
    events.value.push(`accountsChanged:${JSON.stringify(data)}`)
    refreshState()
  })
  window.cashonize?.on('chainChanged', (data) => {
    events.value.push(`chainChanged:${JSON.stringify(data)}`)
    refreshState()
  })
  window.cashonize?.on('disconnect', (data) => {
    events.value.push(`disconnect:${JSON.stringify(data)}`)
    refreshState()
  })
})

onUnmounted(() => {
  window.removeEventListener('bitcoincash:announceProvider', onAnnounce)
})

async function call(method: string, params?: unknown, trackBusy = true) {
  if (!window.cashonize) return
  if (trackBusy) busy.value = true
  response.value = ''
  try {
    const result = await window.cashonize.request({ method, params })
    response.value = JSON.stringify(result)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    response.value = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      code,
    })
  } finally {
    if (trackBusy) busy.value = false
    refreshState()
  }
}

function connect() {
  return call('bch_requestAccounts', {
    dappMetadata: {
      name: 'BCH Test DApp',
      description: 'Playwright fixture for Cashonize',
      url: location.origin,
      icons: [`${location.origin}/icon.png`],
    },
  })
}

function disconnect() {
  return call('bch_disconnect', {})
}

function getAddresses() {
  return call('bch_getAddresses', {})
}

function signMessage() {
  return call('bch_signMessage', { message: 'Hello BCH', userPrompt: 'Sign this message' })
}

function signTransaction() {
  return call('bch_signTransaction', txFixture)
}

function cancelPending() {
  return call('bch_cancelPendingRequests', {}, false)
}

async function sendJsonRpc() {
  if (!window.cashonize) return
  jsonrpcResponse.value = JSON.stringify(await window.cashonize.send({
    jsonrpc: '2.0',
    id: 42,
    method: 'bch_getAddresses',
    params: {},
  }))
  refreshState()
}
</script>

<template>
  <section style="margin-top: 2rem; padding-top: 1rem; border-top: 2px solid #ccc;">
    <h2>Cashonize extension</h2>
    <p>
      WalletConnect-BCH message format over the extension transport, no WalletConnect relay.
      Provider: <strong id="bex-provider-status">{{ available ? 'available' : 'not detected' }}</strong>
    </p>
    <p>
      Discovered providers (<strong id="bex-discovered-count">{{ discovered.length }}</strong>):
    </p>
    <ul id="bex-discovered-providers">
      <li v-for="provider in discovered" :key="provider.info.uuid">
        {{ provider.info.name }} ({{ provider.info.rdns }})
      </li>
    </ul>

    <p>
      chain: <strong id="bex-chain-id">{{ chainId }}</strong> ·
      network: <strong id="bex-network-version">{{ networkVersion }}</strong> ·
      account: <strong id="bex-selected-address">{{ selectedAddress }}</strong> ·
      connected: <strong id="bex-is-connected">{{ connected }}</strong>
    </p>

    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
      <button id="bex-btn-connect" @click="connect" :disabled="!available || busy">Connect</button>
      <button id="bex-btn-disconnect" @click="disconnect" :disabled="!available || busy">Disconnect</button>
      <button id="bex-btn-get-addresses" @click="getAddresses" :disabled="!available || busy">Get Addresses</button>
      <button id="bex-btn-sign-message" @click="signMessage" :disabled="!available || busy">Sign Message</button>
      <button id="bex-btn-sign-transaction" @click="signTransaction" :disabled="!available || busy">Sign Transaction</button>
      <button id="bex-btn-cancel-pending" @click="cancelPending" :disabled="!available">Cancel Pending</button>
      <button id="bex-btn-jsonrpc" @click="sendJsonRpc" :disabled="!available">Send WC2 JSON-RPC</button>
    </div>

    <label>Response:</label>
    <pre id="bex-response" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ response }}</pre>

    <label>WC2 JSON-RPC envelope:</label>
    <pre id="bex-jsonrpc-response" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ jsonrpcResponse }}</pre>

    <label>Provider events:</label>
    <pre id="bex-events" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ events.join('\n') }}</pre>
  </section>
</template>
