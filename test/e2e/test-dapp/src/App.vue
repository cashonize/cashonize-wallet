<script setup lang="ts">
import { ref, computed, watch, onMounted, shallowRef } from 'vue'
import SignClient from '@walletconnect/sign-client'
import type { SessionTypes } from '@walletconnect/types'
import CashConnect from './CashConnect.vue'
import WizardConnect from './WizardConnect.vue'
import BexProvider from './BexProvider.vue'
import { txFixture } from './fixtures'

const client = shallowRef<InstanceType<typeof SignClient> | null>(null)
const session = shallowRef<SessionTypes.Struct | null>(null)
const pairingUri = ref('')
const sessionStatus = ref('disconnected')
const response = ref('')
const loading = ref(false)
const network = ref<'mainnet' | 'chipnet'>('chipnet')
const chainId = computed(() => network.value === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest')

// Incremented to invalidate a pending connect when network switches
let connectGeneration = 0

// Only the most recently initiated request writes to the response box
let responseGeneration = 0

watch(network, () => {
  if (loading.value && !session.value) {
    // Abort pending connect
    connectGeneration++
    pairingUri.value = ''
    loading.value = false
  }
})

const bchNamespace = computed(() => ({
  bch: {
    methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage', 'bch_cancelPendingRequests'],
    chains: [chainId.value],
    events: ['addressesChanged']
  }
}))

onMounted(async () => {
  try {
    const signClient = await SignClient.init({
      projectId: '3fd234b8e2cd0e1da4bc08a0011bbf64',
      metadata: {
        name: 'BCH WC Test dApp',
        description: 'Test dApp for Cashonize E2E tests',
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.png`],
      }
    })

    signClient.on('session_delete', () => {
      session.value = null
      sessionStatus.value = 'disconnected'
      response.value = JSON.stringify({ event: 'session_delete' })
    })

    client.value = signClient
  } catch (error: unknown) {
    response.value = JSON.stringify({ error: `Init failed: ${errorMessage(error)}` })
  }
})

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) return JSON.stringify(error)
  return String(error)
}

function copyUri() {
  void navigator.clipboard.writeText(pairingUri.value)
}

async function connect() {
  if (!client.value) return
  response.value = ''
  loading.value = true
  const generation = ++connectGeneration
  try {
    const { uri, approval } = await client.value.connect({ requiredNamespaces: bchNamespace.value })
    pairingUri.value = uri ?? ''
    const newSession = await approval()
    if (generation !== connectGeneration) return // aborted by network switch
    session.value = newSession
    sessionStatus.value = 'connected'
    pairingUri.value = ''
    response.value = JSON.stringify({
      connected: true,
      topic: newSession.topic,
      chains: newSession.namespaces.bch?.chains,
      methods: newSession.namespaces.bch?.methods,
    })
  } catch (error: unknown) {
    if (generation !== connectGeneration) return // aborted by network switch
    response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (generation === connectGeneration) loading.value = false
  }
}

async function getAddresses() {
  if (!client.value || !session.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await client.value.request({
      topic: session.value.topic,
      chainId: chainId.value,
      request: { method: 'bch_getAddresses', params: {} }
    })
    if (owned === responseGeneration) response.value = JSON.stringify(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function signMessage() {
  if (!client.value || !session.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await client.value.request({
      topic: session.value.topic,
      chainId: chainId.value,
      request: {
        method: 'bch_signMessage',
        params: { message: 'Hello BCH' }
      }
    })
    if (owned === responseGeneration) response.value = JSON.stringify(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function signTransaction() {
  if (!client.value || !session.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await client.value.request({
      topic: session.value.topic,
      chainId: chainId.value,
      request: {
        method: 'bch_signTransaction',
        params: txFixture
      }
    })
    if (owned === responseGeneration) response.value = JSON.stringify(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function cancelPending() {
  if (!client.value || !session.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await client.value.request({
      topic: session.value.topic,
      chainId: chainId.value,
      request: { method: 'bch_cancelPendingRequests', params: {} }
    })
    if (owned === responseGeneration) response.value = JSON.stringify(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function disconnect() {
  if (!client.value || !session.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    await client.value.disconnect({
      topic: session.value.topic,
      reason: { code: 6000, message: 'User disconnected' }
    })
    session.value = null
    sessionStatus.value = 'disconnected'
    if (owned === responseGeneration) response.value = JSON.stringify({ disconnected: true })
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}
</script>

<template>
  <div style="max-width: 720px; margin: 0 auto; padding: 1rem; font-family: monospace;">
    <h2 style="display: flex; align-items: center; gap: 0.5rem;">
      <img src="/icon.png" alt="" style="width: 40px; height: 40px;">
      Bitcoin Cash WalletConnect Test dApp
    </h2>

    <div style="margin-bottom: 1rem; display: flex; align-items: center; gap: 1rem;">
      <label style="cursor: pointer;">
        <input type="radio" name="network" value="chipnet" v-model="network" :disabled="!!session"> chipnet
      </label>
      <label style="cursor: pointer;">
        <input type="radio" name="network" value="mainnet" v-model="network" :disabled="!!session"> mainnet
      </label>
      <span>Status: <strong id="session-status">{{ sessionStatus }}</strong></span>
      <span v-if="loading"> (loading...)</span>
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
      <button id="btn-connect" @click="connect" :disabled="!!session || loading">Connect</button>
      <button id="btn-get-addresses" @click="getAddresses" :disabled="!session || loading">Get Addresses</button>
      <button id="btn-sign-message" @click="signMessage" :disabled="!session || loading">Sign Message</button>
      <button id="btn-sign-transaction" @click="signTransaction" :disabled="!session || loading">Sign Transaction</button>
      <button id="btn-cancel-pending" @click="cancelPending" :disabled="!session">Cancel Pending</button>
      <button id="btn-disconnect" @click="disconnect" :disabled="!session || loading">Disconnect</button>
    </div>

    <div v-if="pairingUri" style="margin-bottom: 1rem;">
      <label>Pairing URI:</label>
      <div id="pairing-uri" style="word-break: break-all; padding: 0.5rem; background: #f0f0f0; font-size: 0.75rem;">{{ pairingUri }}</div>
      <button id="btn-copy-uri" @click="copyUri" style="margin-top: 0.25rem; font-size: 0.75rem;">Copy</button>
    </div>

    <div>
      <label>Response:</label>
      <pre id="response" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ response }}</pre>
    </div>

    <BexProvider />
    <CashConnect />
    <WizardConnect />
  </div>
</template>
