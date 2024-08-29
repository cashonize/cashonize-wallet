<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDialogPluginComponent } from 'quasar'
import type { BchSession, SignTransactionV0 } from 'cashconnect';
import type { SignTransactionV0Params, SignTransactionV0Response } from 'cashconnect';
import { binToHex, binToNumberUintLE, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { useStore } from 'src/stores/store';
import { useSettingsStore } from 'src/stores/settingsStore';

const store = useStore();
const settingsStore = useSettingsStore();

const props = defineProps<{
  session: BchSession,
  params: SignTransactionV0['request']['params'],
  response: SignTransactionV0['response'],
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

// State to store fetched token info from BCMR.
const tokens = ref<{ [categoryId: string]: any }>({});

function getTokenName(categoryId: string | number) {
  // NOTE: This is a remote payload, so we wrap in a try/catch for graceful failure.
  try {
    const tokenInfo = tokens.value[categoryId];

    if(!tokenInfo) {
      return categoryId;
    }

    return tokenInfo.name;
  } catch(error) {
    console.warn(`${error}`);

    return categoryId;
  }
}

props.session.requiredNamespaces?.bch?.allowedTokens.forEach(async (tokenId) => {
  try {
    const tokenInfo = await store.fetchTokenInfo(tokenId);
    tokens.value[tokenId] = await tokenInfo.json();
    console.log(tokens.value);
  } catch(error) {
    console.warn(`${error}`);
  }
});

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

const paymentAmounts = computed(() => {
  const amounts: { [category: string]: bigint } = {
    sats: 0n
  }

  pairedTxs.value.forEach((pairTx) => {
    // First, calculate our inputs.
    pairTx.response.sourceOutputs.forEach((sourceOutput) => {
      amounts.sats += sourceOutput.valueSatoshis
      if(sourceOutput.token) {
        const catIdAsHex = binToHex(sourceOutput.token.category)

        if(!amounts[catIdAsHex]) {
          amounts[catIdAsHex] = 0n;
        }

        amounts[catIdAsHex] += sourceOutput.token.amount;
      }
    });

    // And then subtract our change ouputs.
    pairOutputs(pairTx).forEach((pairedOutput) => {
      if(!pairedOutput.params) {
        amounts.sats -= pairedOutput.response.valueSatoshis;
        if(pairedOutput.response.token) {
          const catIdAsHex = binToHex(pairedOutput.response.token.category);

          amounts[catIdAsHex] -= pairedOutput.response.token.amount;
        }
      }
    });
  });

  return amounts;
});

//-----------------------------------------------------------------------------
// Formatting Utils
//-----------------------------------------------------------------------------

function formatBin(bin: Uint8Array) {
  return binToHex(bin);
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
  if (numberAmount >= 1000) {
    const bchAmount = numberAmount * (10 ** -8)
    return `${bchAmount.toFixed(8)} BCH`
  } else {
    return `${numberAmount} Sats`
  }
};
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card style="width:600px; max-width:100%;">
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

        <div class="cc-modal-heading">Amounts</div>
        <q-markup-table flat>
          <tr v-for="(amount, category) of paymentAmounts" :key="category">
            <th>{{ (category === 'sats') ? 'BCH' : getTokenName(category) }}</th>
            <td>{{ (category === 'sats') ? formatSats(amount) : amount }}</td>
          </tr>
        </q-markup-table>

        <hr/>

        <div class="cc-modal-heading">Transaction Details</div>
        <div v-for="(pairedTx, i) of pairedTxs" :key="i" class="cc-modal-details">
          <q-expansion-item
            :label="`Tx #${i} - ${pairedTx.params.userPrompt}`"
          >
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
                            <th colspan="2">
                              {{ formatScriptName(input.params.script, session.requiredNamespaces.bch.template) }}
                            </th>
                          </tr>
                          <template v-for="(value, id) of input.params.data" :key="id">
                            <tr><th>{{ formatDataName(id, session.requiredNamespaces.bch.template) }}</th></tr>
                            <tr><td>{{ formatDataValue(value, id, session.requiredNamespaces.bch.template) }}</td></tr>
                          </template>
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
                              Token: {{ getTokenName(binToHex(output.response.token.category)) }}
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
                            <th colspan="2">
                              {{ formatScriptName(output.params.script, session.requiredNamespaces.bch.template) }}
                            </th>
                          </tr>
                          <template v-for="(value, id) of output.params.data" :key="id">
                            <tr><th>{{ formatDataName(id, session.requiredNamespaces.bch.template) }}</th></tr>
                            <tr><td>{{ formatDataValue(value, id, session.requiredNamespaces.bch.template) }}</td></tr>
                          </template>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
          </q-expansion-item>
        </div>

        <hr/>

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
</style>
