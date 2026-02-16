<script setup lang="ts">
import { ref, computed, watch, onMounted, shallowRef } from 'vue'
import SignClient from '@walletconnect/sign-client'
import type { SessionTypes } from '@walletconnect/types'

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

// Transaction fixture from test/fixtures/wcFixtures.ts (cashNinjaJsonString0), with broadcast: false
const txFixture = {
  transaction: '02000000021662e68cb471cef702a3f0bc5227737887ce790714e7c45ffb6f215ef01b806200000000a7004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168feffffffd94402d4efa7621faee88109bd4f9044f4d87f47cf0a60170a58ce8ae4a71ed10000000000feffffff03284f4c000000000048efacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776202f406aa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87e8030000000000003eefacd8c6620010efc41558a398a6bf2e90ea3a32ef4a3840c392237ca01054a9776002db0676a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88acbf50bf07000000001976a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac00000000',
  sourceOutputs: [
    {
      outpointIndex: 0,
      outpointTransactionHash: '<Uint8Array: 0x62801bf05e216ffb5fc4e7140779ce8778732752bcf0a302f7ce71b48ce66216>',
      sequenceNumber: 4294967294,
      unlockingBytecode: '<Uint8Array: 0x004ca4028713141b07ddefd36439f60bf596c4f891f8f6ce3dbe20011903404b4c5479009c63c0009d00cf8176557aa169c453a16900cd00c78800d100ce8876537a9300d28800cc00c6537a939d51cc02e8039d51d28800ce01207f7551d188c4539c6352d10088686d5167547a519d5579a9537a88537a547aadc3519d00cf81537aa163c4529d00cd00c78800d100ce8800d200cf8851d1008867c4519d00d10088686d5168>',
      lockingBytecode: '<Uint8Array: 0xaa203e7393b927649d62674dfa9883b0faa27188730ee7b4086fa5861b2df915142a87>',
      valueSatoshis: '<bigint: 1000n>',
      token: {
        amount: '<bigint: 0n>',
        category: '<Uint8Array: 0x77a95410a07c2392c340384aef323aea902ebfa698a35815c4ef100062c6d8ac>',
        nft: {
          capability: 'minting',
          commitment: '<Uint8Array: 0xdb06>',
        },
      },
    },
    {
      outpointIndex: 0,
      outpointTransactionHash: '<Uint8Array: 0xd11ea7e48ace580a17600acf477fd8f444904fbd0981e8ae1f62a7efd40244d9>',
      sequenceNumber: 4294967294,
      unlockingBytecode: '<Uint8Array: 0x>',
      lockingBytecode: '<Uint8Array: 0x76a9148ee26d6c9f58369f94864dc3630cdeb17fae2f2d88ac>',
      valueSatoshis: '<bigint: 134980559n>',
    },
  ],
  broadcast: false,
  userPrompt: 'Test transaction',
}

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
    response.value = JSON.stringify({ connected: true, topic: newSession.topic })
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
  </div>
</template>
