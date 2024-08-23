<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar'
import type { BchSession, SignTransactionV0 } from 'cashconnect';
import { binToHex, binToNumberUintLE, lockingBytecodeToCashAddress } from '@bitauth/libauth';

defineProps<{
  session: BchSession,
  params: SignTransactionV0['request']['params'],
  response: SignTransactionV0['response'],
}>()

defineEmits([
  // REQUIRED; need to specify some events that your
  // component will emit through useDialogPluginComponent()
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

function onOKClick () {
  onDialogOK()
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

function formatScriptName(scriptId: string, template: any) {
  return template?.scripts?.[scriptId]?.name || scriptId;
};

function formatDataName(dataId: string, template: any) {
  return template?.entities?.common?.variables?.[dataId]?.name || dataId;
};

function formatDataValue(value: Uint8Array, dataId: string, template: any) {
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
        <div style="font-size: large; margin-top: 2rem;">Origin:</div>
        <div style="display: flex; align-items: center; flex-direction: row; gap: 10px; padding: 7px;">
          <div style="display: flex; align-items: center; height: 64px; width: 64px;"><img :src="session.peer.metadata.icons[0]"></div>
          <div style="display: flex; flex-direction: column; width: 100%;">
            <div>{{ session.peer.metadata.name }}</div>
            <div style="overflow-wrap: anywhere;"><a :href="session.peer.metadata.url" target="_blank">{{ session.peer.metadata.url }}</a></div>
            <div style="overflow-x: hidden; text-overflow: ellipsis; font-size: smaller;">{{ formatSessionSigner(session) }}</div>
          </div>
        </div>

        <hr style="margin-top:3rem" />

        <div v-for="(tx, i) of params" :key="i" class="cc-modal-details">
          <!-- User Prompt -->
          <div v-if="tx.userPrompt" style="display: flex; justify-content: center; font-size: larger;">{{ tx.userPrompt }}</div>

          <!-- Inputs -->
          <div class="cc-modal-heading">Inputs</div>
          <table class="cc-data-table">
            <tbody v-for="(input, index) of response[i].transaction.inputs" :key="index">
              <tr>
                <td>{{ index }}</td>
                <td>{{ formatBin(input.outpointTransactionHash) }}:{{ input.outpointIndex }}</td>
                <td class="satoshis">
                  {{ formatSats(response[i].sourceOutputs[index].valueSatoshis) }}
                </td>
              </tr>
              <!-- If there is data available for this input -->
              <tr v-if="tx.transaction.inputs?.[index]?.data">
                <td colspan="3">
                  <table class="tx-data-table">
                    <tbody>
                      <tr>
                        <td colspan="2">
                          <strong>{{ formatScriptName(tx.transaction.inputs[index].script, session.requiredNamespaces.bch.template) }}</strong>
                        </td>
                      </tr>
                      <tr v-for="(value, id) of tx.transaction.inputs?.[index]?.data" :key="id">
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
            <tbody v-for="(output, index) of response[i].transaction.outputs" :key="index">
              <tr>
                <td>{{ index }}</td>
                <td>{{ formatLockscript(output.lockingBytecode) }}</td>
                <td class="satoshis">{{ formatSats(output.valueSatoshis) }}</td>
              </tr>
              <!-- If there is a token available on this output -->
              <tr v-if="output.token">
                <td colspan="3">
                  <table class="tx-data-table">
                    <tbody>
                      <tr>
                        <td>
                          Token: {{ formatBin(output.token.category) }}
                        </td>
                        <td>
                          Amount: {{ Number(output.token.amount) }}
                        </td>
                      </tr>
                      <tr v-if="output.token?.nft">
                        <td>Commitment: {{ formatBin(output.token.nft.commitment) }}</td>
                        <td>Capability: {{ output.token.nft.capability }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
              <!-- If there is data available for this output -->
              <tr v-if="tx.transaction.outputs?.[index]?.data">
                <td colspan="3">
                  <table class="tx-data-table">
                    <tbody>
                      <tr>
                        <td colspan="2">
                          <strong>{{ formatScriptName(tx.transaction.outputs[index].script, session.requiredNamespaces.bch.template) }}</strong>
                        </td>
                      </tr>
                      <tr v-for="(value, id) of tx.transaction.outputs?.[index]?.data" :key="id">
                        <td>{{ formatDataName(id, session.requiredNamespaces.bch.template) }}</td>
                        <td>{{ formatDataValue(value, id, session.requiredNamespaces.bch.template) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          <hr style="margin-top: 3rem;" />
        </div>

        <!-- Bottom Buttons -->
        <div class="cc-modal-bottom-buttons">
          <q-btn color="primary" label="OK" @click="onOKClick" />
          <q-btn color="negative" label="Cancel" @click="onDialogCancel" />
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>
