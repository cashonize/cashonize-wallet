<script setup lang="ts">
import { ref, shallowRef, onUnmounted } from 'vue'
import { DappConnectionManager } from '@wizardconnect/dapp'
import { initiateDappRelay, type DappRelayResult, type SignTransactionRequest } from '@wizardconnect/core'
import {
  binToHex,
  hexToBin,
  hash160,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  decodeTransaction,
  createVirtualMachineBch,
} from '@bitauth/libauth'

const manager = shallowRef<DappConnectionManager | null>(null)
const relay = shallowRef<DappRelayResult | null>(null)
const pairingUri = ref('')
const status = ref('disconnected')
const response = ref('')
const signing = ref(false)
let signAbort: AbortController | null = null

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) return JSON.stringify(error)
  return String(error)
}

function teardown() {
  manager.value?.destroy()
  relay.value?.cleanup()
  manager.value = null
  relay.value = null
  pairingUri.value = ''
  signAbort = null
  signing.value = false
}

onUnmounted(teardown)

function connect() {
  teardown()
  response.value = ''
  // Session persistence is disabled so every test run starts from a clean pairing
  const newManager = new DappConnectionManager('Wiz Test dApp', `${window.location.origin}/icon.png`, { session: false })
  newManager.on('walletready', () => {
    status.value = 'connected'
    pairingUri.value = ''
    response.value = JSON.stringify({
      walletName: newManager.walletName,
      paths: newManager.getSessionPaths().map((sessionPath) => sessionPath.name),
    })
  })
  newManager.on('disconnect', (reason) => {
    status.value = 'disconnected'
    response.value = JSON.stringify({ event: 'disconnect', reason })
  })
  const newRelay = initiateDappRelay((payload) => {
    newManager.updateConnection(payload.client, payload.status)
  })
  manager.value = newManager
  relay.value = newRelay
  pairingUri.value = newRelay.uri
  status.value = 'waiting'
}

function copyUri() {
  void navigator.clipboard.writeText(pairingUri.value)
}

async function signTransaction() {
  if (!manager.value) return
  response.value = ''
  const receivePubkey = manager.value.getPubkey(0, 0n)
  if (!receivePubkey) {
    response.value = JSON.stringify({ error: 'No receive pubkey available (wallet_ready not received?)' })
    return
  }
  // Fake UTXO paying to the wallet's receive/0 address. Signing does not require the
  // UTXO to exist on-chain: the signature commits to the claimed sourceOutputs
  // (SIGHASH_UTXOS), so the returned transaction can be fully VM-verified locally.
  const walletLockingBytecode = encodeLockingBytecodeP2pkh(hash160(receivePubkey))
  const fakeOutpointHash = new Uint8Array(32).fill(0xaa)
  const sourceOutput = {
    outpointIndex: 0,
    outpointTransactionHash: fakeOutpointHash,
    sequenceNumber: 0,
    unlockingBytecode: new Uint8Array(),
    lockingBytecode: walletLockingBytecode,
    valueSatoshis: 10_000n,
  }
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [{
      outpointIndex: 0,
      outpointTransactionHash: fakeOutpointHash,
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(),
    }],
    outputs: [{
      lockingBytecode: walletLockingBytecode,
      valueSatoshis: 9_500n,
    }],
  }
  // Wire format mirroring the reference serializer: hex strings for bytes, "<bigint: Xn>" for amounts
  const wireRequest = {
    transaction: {
      transaction: binToHex(encodeTransaction(transaction)),
      sourceOutputs: [{
        outpointIndex: 0,
        outpointTransactionHash: binToHex(fakeOutpointHash),
        sequenceNumber: 0,
        unlockingBytecode: '',
        lockingBytecode: binToHex(walletLockingBytecode),
        valueSatoshis: '<bigint: 10000n>',
      }],
      broadcast: false,
      userPrompt: 'Wiz test transaction',
    },
    inputPaths: [[0, 'receive', 0]],
  } as unknown as Pick<SignTransactionRequest, 'transaction' | 'inputPaths'>
  signAbort = new AbortController()
  signing.value = true
  try {
    const result = await manager.value.signTransaction(wireRequest, { signal: signAbort.signal })
    // Verify the returned signature end-to-end with the libauth VM
    const signedTransaction = decodeTransaction(hexToBin(result.signedTransaction))
    const vmResult = typeof signedTransaction === 'string'
      ? signedTransaction
      : createVirtualMachineBch(true).verify({ transaction: signedTransaction, sourceOutputs: [sourceOutput] })
    response.value = JSON.stringify({
      signedTransaction: result.signedTransaction,
      vmVerified: vmResult === true,
      ...(vmResult !== true ? { vmError: vmResult } : {}),
    })
  } catch (error: unknown) {
    response.value = JSON.stringify({ error: errorMessage(error) })
  } finally {
    signAbort = null
    signing.value = false
  }
}

function cancelSign() {
  signAbort?.abort('Cancelled by test dApp')
}

async function disconnect() {
  if (!manager.value) return
  try {
    await manager.value.sendDisconnect('Test dApp disconnected')
  } catch (error: unknown) {
    console.error('sendDisconnect failed:', error)
  }
  teardown()
  status.value = 'disconnected'
  response.value = JSON.stringify({ disconnected: true })
}
</script>

<template>
  <div style="margin-top: 2rem; border-top: 2px solid #ccc; padding-top: 1rem;">
    <h2>WizardConnect Test dApp</h2>

    <div style="margin-bottom: 1rem;">
      <span>Status: <strong id="wiz-session-status">{{ status }}</strong></span>
      <span v-if="signing"> (awaiting signature...)</span>
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
      <button id="wiz-btn-connect" @click="connect">Connect</button>
      <button id="wiz-btn-sign-transaction" @click="signTransaction" :disabled="status !== 'connected' || signing">Sign Transaction</button>
      <button id="wiz-btn-cancel-sign" @click="cancelSign" :disabled="!signing">Cancel Sign</button>
      <button id="wiz-btn-disconnect" @click="disconnect" :disabled="status === 'disconnected'">Disconnect</button>
    </div>

    <div v-if="pairingUri" style="margin-bottom: 1rem;">
      <label>Pairing URI:</label>
      <div id="wiz-pairing-uri" style="word-break: break-all; padding: 0.5rem; background: #f0f0f0; font-size: 0.75rem;">{{ pairingUri }}</div>
      <button id="wiz-btn-copy-uri" @click="copyUri" style="margin-top: 0.25rem; font-size: 0.75rem;">Copy</button>
    </div>

    <div>
      <label>Response:</label>
      <pre id="wiz-response" style="padding: 0.5rem; background: #f0f0f0; min-height: 2rem; white-space: pre-wrap; word-break: break-all;">{{ response }}</pre>
    </div>
  </div>
</template>
