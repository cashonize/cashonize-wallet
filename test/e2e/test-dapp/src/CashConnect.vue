<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'
import { Dapp } from '@cashconnect-js/nostr/dapp'
import { MemoryStore } from '@cashconnect-js/nostr'
import { Address, Bytes, encodeExtendedJson } from '@cashconnect-js/core/primitives'
import type { Template } from '@cashconnect-js/core/templates'

// Raw-JSON equivalent of the "Simple Send" template from the CashConnect tutorial
// (https://cashconnect.developers.cash/docs/tutorials/1-first-template.html), plus a
// resolve-only action. Written without the @cashconnect-js/templates-sdk helpers so the
// test dapp only depends on the exact alpha versions pinned in the main app.
const CC_TEMPLATE = {
  name: 'Cashonize E2E Test Template',
  description: 'Template for Cashonize CashConnect E2E tests',
  actions: {
    // Resolve-only action: does not contain a transaction instruction, so the wallet
    // auto-responds without showing an approval dialog.
    ping: {
      params: {
        someString: { name: 'Some String', type: 'string' },
      },
      instructions: [
        {
          type: 'resolve',
          payload: {
            echoed: '<someString>',
            fixed: '<123>',
          },
        },
      ],
      returns: {
        echoed: { name: 'Echoed String', type: 'string' },
        fixed: { name: 'The number 123', type: 'number' },
      },
    },
    // Transaction action: requires approval in the wallet and spends real wallet UTXOs.
    send: {
      meta: {
        title: 'Send',
        description: 'Send {{ <recipientSatsAmount> | satoshis }} to {{ <recipientLockingBytecode> | address }}',
      },
      params: {
        recipientLockingBytecode: { name: 'Recipient Locking Bytecode', type: 'address' },
        recipientSatsAmount: { name: 'Amount to send (Sats)', type: 'satoshis' },
      },
      instructions: [
        {
          type: 'transaction',
          payload: {
            name: 'tx',
            version: 2,
            locktime: 0,
            // Use any available inputs from the parent wallet.
            inputs: ['*'],
            outputs: [
              {
                lockingBytecode: '<recipientLockingBytecode>',
                valueSatoshis: '<recipientSatsAmount>',
              },
              // Append any change outputs to the parent wallet.
              '*',
            ],
            validate: true,
          },
        },
      ],
      returns: {
        txHash: { name: 'Transaction Hash', type: 'transactionHash' },
      },
    },
  },
  scripts: {},
} as const satisfies Template

const dapp = shallowRef<Dapp<typeof CC_TEMPLATE> | null>(null)
const sessionStatus = ref('disconnected')
const inviteUri = ref('')
const response = ref('')
const recipientAddress = ref('')
const loading = ref(false)
const network = ref<'mainnet' | 'chipnet'>('chipnet')
const chain = computed(() => network.value === 'mainnet' ? 'bitcoincash' as const : 'bchtest' as const)

// Abort controller for the in-flight send request (dapp-side cancel test)
let sendAbortController: AbortController | null = null

// Only the most recently initiated request writes to the response box
let responseGeneration = 0

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) return JSON.stringify(error)
  return String(error)
}

function copyUri() {
  void navigator.clipboard.writeText(inviteUri.value)
}

async function connect() {
  // Abandon any previous instance — its pair() may still be pending (a rejected pairing
  // is not signalled to the dapp; it just keeps waiting).
  if (dapp.value) {
    await dapp.value.stop().catch(() => undefined)
    dapp.value = null
  }
  response.value = ''
  inviteUri.value = ''
  sessionStatus.value = 'connecting'
  try {
    const newDapp = new Dapp({
      info: {
        name: 'BCH CC Test dApp',
        description: 'CashConnect test dApp for Cashonize E2E tests',
        url: window.location.origin,
        icon: `${window.location.origin}/icon.png`,
      },
      chain: chain.value,
      template: CC_TEMPLATE,
      allowedTokens: [],
      // In-memory store so repeated connect attempts (e.g. after an abandoned pairing)
      // don't share dapp identity/session state through localStorage.
      store: new MemoryStore(),
    })
    newDapp.on('sessionDeleted', () => {
      if (dapp.value !== newDapp) return
      sessionStatus.value = 'disconnected'
      response.value = JSON.stringify({ event: 'sessionDeleted' })
    })
    await newDapp.start()
    dapp.value = newDapp
    inviteUri.value = newDapp.createInviteUrl()
    sessionStatus.value = 'pairing'

    const result = await newDapp.pair()
    if (dapp.value !== newDapp) return // superseded by a newer connect attempt
    sessionStatus.value = 'connected'
    inviteUri.value = ''
    response.value = encodeExtendedJson({ connected: true, walletPubkey: result.walletPubkey })
  } catch (error: unknown) {
    sessionStatus.value = 'disconnected'
    response.value = JSON.stringify({ error: errorMessage(error) })
  }
}

async function ping() {
  if (!dapp.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await dapp.value.executeAction('ping', {
      someString: Bytes.fromUtf8('hello cashonize'),
    })
    if (owned === responseGeneration) response.value = encodeExtendedJson(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function send() {
  if (!dapp.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  sendAbortController = new AbortController()
  try {
    const result = await dapp.value.executeAction('send', {
      recipientLockingBytecode: Address.from(recipientAddress.value).toLockscriptBytes(),
      recipientSatsAmount: Bytes.fromBigInt(1000n),
    }, { signal: sendAbortController.signal })
    if (owned === responseGeneration) response.value = encodeExtendedJson(result)
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    sendAbortController = null
    if (owned === responseGeneration) loading.value = false
  }
}

function cancelSend() {
  sendAbortController?.abort()
}

async function getBalances() {
  if (!dapp.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await dapp.value.getBalances()
    if (owned === responseGeneration) response.value = encodeExtendedJson({ balances: result })
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function getTokens() {
  if (!dapp.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    const result = await dapp.value.getTokens()
    if (owned === responseGeneration) response.value = encodeExtendedJson({ tokens: result })
  } catch (error: unknown) {
    if (owned === responseGeneration) response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    if (owned === responseGeneration) loading.value = false
  }
}

async function disconnect() {
  if (!dapp.value) return
  const owned = ++responseGeneration
  response.value = ''
  loading.value = true
  try {
    await dapp.value.forgetSession('User disconnected')
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
  <div style="margin-top: 2rem;">
    <h2>Bitcoin Cash CashConnect Test dApp</h2>

    <div style="margin-bottom: 1rem; display: flex; align-items: center; gap: 1rem;">
      <label style="cursor: pointer;">
        <input type="radio" id="cc-radio-chipnet" name="cc-network" value="chipnet" v-model="network" :disabled="sessionStatus === 'connected'"> chipnet
      </label>
      <label style="cursor: pointer;">
        <input type="radio" id="cc-radio-mainnet" name="cc-network" value="mainnet" v-model="network" :disabled="sessionStatus === 'connected'"> mainnet
      </label>
      <span>Status: <strong id="cc-session-status">{{ sessionStatus }}</strong></span>
      <span v-if="loading"> (loading...)</span>
    </div>

    <div style="margin-bottom: 1rem;">
      <label>Recipient address (for Send):</label>
      <input id="cc-input-address" v-model="recipientAddress" style="width: 100%; font-size: 0.75rem;" placeholder="bchtest:...">
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
      <button id="cc-btn-connect" @click="connect" :disabled="sessionStatus === 'connected'">Connect</button>
      <button id="cc-btn-ping" @click="ping" :disabled="sessionStatus !== 'connected' || loading">Ping (resolve)</button>
      <button id="cc-btn-send" @click="send" :disabled="sessionStatus !== 'connected' || loading">Send (transaction)</button>
      <button id="cc-btn-cancel" @click="cancelSend" :disabled="sessionStatus !== 'connected'">Cancel Send</button>
      <button id="cc-btn-get-balances" @click="getBalances" :disabled="sessionStatus !== 'connected' || loading">Get Balances</button>
      <button id="cc-btn-get-tokens" @click="getTokens" :disabled="sessionStatus !== 'connected' || loading">Get Tokens</button>
      <button id="cc-btn-disconnect" @click="disconnect" :disabled="sessionStatus !== 'connected' || loading">Disconnect</button>
    </div>

    <div v-if="inviteUri" style="margin-bottom: 1rem;">
      <label>Invite URI:</label>
      <div id="cc-pairing-uri" style="word-break: break-all; padding: 0.5rem; background: #f0f0f0; font-size: 0.75rem;">{{ inviteUri }}</div>
      <button id="cc-btn-copy-uri" @click="copyUri" style="margin-top: 0.25rem; font-size: 0.75rem;">Copy</button>
    </div>

    <div>
      <label>Response:</label>
      <pre id="cc-response" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ response }}</pre>
    </div>
  </div>
</template>
