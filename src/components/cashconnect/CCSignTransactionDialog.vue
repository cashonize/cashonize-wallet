<script setup lang="ts">
import { computed } from 'vue';
import { useDialogPluginComponent } from 'quasar'
import type { BchSession, SignTransactionV0 } from 'cashconnect';
import type { SignTransactionV0Params, SignTransactionV0Response } from 'cashconnect';
import { binToHex, binToNumberUintLE, lockingBytecodeToCashAddress } from '@bitauth/libauth';

const props = defineProps<{
  session: BchSession,
  params: SignTransactionV0['request']['params'],
  response: SignTransactionV0['response'],
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

function onOKClick () {
  onDialogOK()
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

// NOTE: These are a bit dirty. Pre-Alpha CC doesn't, technically, have a concept of "actions".
//       We emulate actions by allowing multiple transactions to pass into signTransaction.
//       So we need this to satisfy the typing in our templates.
//       The V1 release handles this much nicer.

type PairedTx = {
  params: SignTransactionV0Params,
  response: SignTransactionV0Response,
}

const pairedTxs = computed((): Array<PairedTx> => {
  return props.response.map((responseTx, i) => ({
    params: props.params[i],
    response: responseTx,
  }));
});

function pairInputs(pairedTx: PairedTx) {
  return pairedTx.response.transaction.inputs.map((input, i) => ({
    params: pairedTx.params.transaction?.inputs?.[i],
    response: input
  }));
}

function pairOutputs(pairedTx: PairedTx) {
  return pairedTx.response.transaction.outputs.map((output, i) => ({
    params: pairedTx.params.transaction?.outputs?.[i],
    response: output
  }));
}

//-----------------------------------------------------------------------------
// Formatting Utils
//-----------------------------------------------------------------------------

function formatBin(bin: Uint8Array) {
  return binToHex(bin);
};

function formatSessionSigner(session: BchSession) {
  return session?.namespaces?.['bch']?.accounts?.[0] || 'Unable to display signer';
};

function formatScriptName(scriptId: string | number, template: any) {
  return template?.scripts?.[scriptId]?.name || scriptId;
};

function formatDataName(dataId: string | number, template: any) {
  return template?.entities?.common?.variables?.[dataId]?.name || dataId;
};

function formatDataValue(value: Uint8Array, dataId: string | number, template: any) {
  const type = template?.entities?.common?.variables?.[dataId]?.description;

  switch (type) {
    case 'lockscript': return formatLockscript(value);
    case 'number': return binToNumberUintLE(value);
    case 'unixTimestamp': return new Date(binToNumberUintLE(value) * 1000).toISOString();
  }

  return `0x${binToHex(value)}`;
};

function formatLockscript(lockingBytecode: Uint8Array) {
  const result = lockingBytecodeToCashAddress(lockingBytecode, 'bitcoincash');
  if (typeof result !== "string") {
    return binToHex(lockingBytecode);
  }
  return result;
};

function formatSats(satoshis: bigint) {
  const numberAmount = Number(satoshis);
  if (Math.abs(numberAmount / (10 ** 4)) > 1000) {
    const bchAmount = numberAmount * (10 ** -8)
    return `${bchAmount.toFixed(8)} BCH`
  } else {
    return `${numberAmount} Sats`
  }
};
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card>
      <fieldset class="cc-modal-fieldset">
        <legend class="cc-modal-fieldset-legend">Sign Transaction</legend>

        <!-- Origin -->
        <q-item>
          <q-item-section avatar>
            <img :src="session.peer.metadata.icons[0]" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ session.peer.metadata.name }}</q-item-label>
            <q-item-label>
              <a :href="session.peer.metadata.url" target="_blank">{{ session.peer.metadata.url }}</a>
            </q-item-label>
          </q-item-section>
        </q-item>

        <hr />

        <div v-for="(pairedTx, i) of pairedTxs" :key="i" class="cc-modal-details">
          <!-- User Prompt -->
          <!--
          <div v-if="pairedTx.params.userPrompt" style="display: flex; justify-content: center; font-size: larger;">{{ pairedTx.params.userPrompt }}</div>
          -->

          <q-expansion-item
            dense
            dense-toggle
            expand-separator
            :label="`Tx #${i} - ${pairedTx.params.userPrompt}`"
          >
            <div class="cc-tx-container">
              <!-- Inputs -->
              <div class="cc-modal-heading">Inputs</div>
              <table class="cc-data-table">
                <tbody v-for="(input, index) of pairInputs(pairedTx)" :key="index">
                  <tr>
                    <td>{{ index }}</td>
                    <td>{{ formatBin(input.response.outpointTransactionHash) }}:{{ input.response.outpointIndex }}</td>
                    <td class="satoshis">
                      {{ formatSats(response[i].sourceOutputs[index].valueSatoshis) }}
                    </td>
                  </tr>
                  <!-- If there is data available for this input -->
                  <tr v-if="input.params && 'data' in input.params">
                    <td colspan="3">
                      <table class="tx-data-table">
                        <tbody>
                          <tr>
                            <td colspan="2">
                              <strong>{{ formatScriptName(input.params.script, session.requiredNamespaces.bch.template) }}</strong>
                            </td>
                          </tr>
                          <tr v-for="(value, id) of input.params.data" :key="id">
                            <td>{{ formatDataName(id, session.requiredNamespaces.bch.template) }}</td>
                            <td>{{ formatDataValue(value, id, session.requiredNamespaces.bch.template) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>

              <!-- Outputs -->
              <div class="cc-modal-heading">Outputs</div>
              <table class="cc-data-table">
                <tbody v-for="(output, index) of pairOutputs(pairedTx)" :key="index">
                  <tr>
                    <td>{{ index }}</td>
                    <td>{{ formatLockscript(output.response.lockingBytecode) }}</td>
                    <td class="satoshis">{{ formatSats(output.response.valueSatoshis) }}</td>
                  </tr>
                  <!-- If there is a token available on this output -->
                  <tr v-if="output.response.token">
                    <td colspan="3">
                      <table class="tx-data-table">
                        <tbody>
                          <tr>
                            <td>
                              Token: {{ formatBin(output.response.token.category) }}
                            </td>
                            <td>
                              Amount: {{ Number(output.response.token.amount) }}
                            </td>
                          </tr>
                          <tr v-if="output.response.token?.nft">
                            <td>Commitment: {{ formatBin(output.response.token.nft.commitment) }}</td>
                            <td>Capability: {{ output.response.token.nft.capability }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <!-- If there is data available for this output -->
                  <tr v-if="output.params && 'data' in output.params">
                    <td colspan="3">
                      <table class="tx-data-table">
                        <tbody>
                          <tr>
                            <td colspan="2">
                              <strong>{{ formatScriptName(output.params.script, session.requiredNamespaces.bch.template) }}</strong>
                            </td>
                          </tr>
                          <tr v-for="(value, id) of output.params.data" :key="id">
                            <td>{{ formatDataName(id, session.requiredNamespaces.bch.template) }}</td>
                            <td>{{ formatDataValue(value, id, session.requiredNamespaces.bch.template) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </q-expansion-item>
        </div>

        <!-- Bottom Buttons -->
        <div class="cc-modal-bottom-buttons">
          <div class="row q-col-gutter-x-md">
            <div class="col text-right">
              <q-btn class="cc-modal-button" color="primary" label="Confirm" @click="onOKClick" />
            </div>
            <div class="col text-left">
              <q-btn class="cc-modal-button" color="negative" label="Cancel" @click="onDialogCancel" />
            </div>
          </div>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    max-width: 100%;
    height: 220px;
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }

  .cc-tx-container {
    max-width: 100%;
    overflow-x: auto;
  }

  .cc-hack-width {
    width: 1px;
  }
</style>
