<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDialogPluginComponent } from 'quasar'
import { type BchSession, type ExecuteActionPayload } from '@cashconnect-js/core';
import { formatSegment } from '@cashconnect-js/wallet';
import { type BcmrIndexerResponse, CurrencySymbols } from 'src/interfaces/interfaces';
import { convertToCurrency } from 'src/utils/utils';
import { useStore } from 'src/stores/store';
import { useSettingsStore } from 'src/stores/settingsStore';
import { caughtErrorToString } from 'src/utils/errorHandling';
const store = useStore()
const settingsStore = useSettingsStore()

const props = defineProps<{
  session: BchSession,
  request: ExecuteActionPayload['request'],
  response: ExecuteActionPayload['response'],
  exchangeRate: number,
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

const title = computed(() => {
  return props.response.meta?.title || [props.request.params.action];
});

const description = computed(() => {
  return props.response.meta?.description || ['No description for this action available.']
})

//-----------------------------------------------------------------------------
// Tokens
//-----------------------------------------------------------------------------

// State to store fetched token info from BCMR.
const tokens = ref<{ [categoryId: string]: BcmrIndexerResponse }>({});

function getTokenName(categoryId: string | number) {
  // NOTE: This is a remote payload, so we wrap in a try/catch for graceful failure.
  try {
    const tokenInfo = tokens.value[categoryId];

    if(!tokenInfo) {
      return categoryId;
    }

    return tokenInfo.name;
  } catch(error) {
    const errorMessage= caughtErrorToString(error)
    console.error(errorMessage);

    return categoryId;
  }
}

async function fetchAndSetTokenInfo(tokenId: string) {
  try {
    const tokenInfo = await store.fetchTokenInfo(tokenId);
    tokens.value[tokenId] = tokenInfo;
  } catch(error) {
    const errorMessage = caughtErrorToString(error)
    console.error(errorMessage);
  }
}
const allowedTokens = props.session.sessionProperties.allowedTokens ?? [];
// fire-and-forget promises
for (const tokenId of allowedTokens) {
  void fetchAndSetTokenInfo(tokenId);
}

//-----------------------------------------------------------------------------
// Formatting Utils
//-----------------------------------------------------------------------------

function addSignPrefixToNumber(value: number | bigint): string {
  if (Number(value) === 0) return `${value}`;
  return Number(value) > 0 ? `+ ${value}` : `- ${-(value)}`;
};

function satsToBCH(satoshis: bigint) {
  return Number(satoshis) / 100_000_000;
};
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale">
    <q-card>
      <fieldset class="cc-modal-fieldset">
        <legend class="cc-modal-fieldset-legend">
          <span v-for="(segment, i) in title" :key="i">
            {{ segment }}
          </span>
        </legend>

        <!-- Origin -->
        <q-item>
          <q-item-section avatar>
            <img :src="session.peer.metadata.icons[0] ?? ''" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ session.peer.metadata.name }}</q-item-label>
            <q-item-label>
              <a :href="session.peer.metadata.url" target="_blank">{{ session.peer.metadata.url }}</a>
            </q-item-label>
          </q-item-section>
        </q-item>

        <hr style="margin-top:1em; margin-bottom: 1em" />

        <div style="font-size: medium; white-space: pre-wrap;">
          <template v-for="(segment, i) in description" :key="i">
            <span v-if="typeof segment === 'string'">{{ segment }}</span>
            <span v-else class="green" style="font-weight:bold">{{ formatSegment(segment) }}</span>
          </template>
        </div>

        <hr style="margin-top:1em; margin-bottom: 1em" />

        <div class="cc-modal-heading" style="margin-top: 1rem;">Balance Change:</div>
        <div v-for="(amount, category) of props.response.balanceChanges" :key="category">
          <div v-if="(category === 'sats')">
            {{ addSignPrefixToNumber(satsToBCH(amount)) + ' BCH ' }}
            ({{ convertToCurrency(amount, props.exchangeRate) + ` ${CurrencySymbols[settingsStore.currency]}`}})
          </div>
          <div v-else>
            <span>{{ addSignPrefixToNumber(amount) + ' ' + getTokenName(category) }}</span>
          </div>
        </div>

        <hr style="margin-top:1em; margin-bottom: 1em" />

        <q-expansion-item label="Advanced">
          Test test test
        </q-expansion-item>

        <hr style="margin-top: 1rem;"/>

        <!-- Approve/Reject Buttons -->
        <div style="margin: 2rem 0; display: flex; gap: 1rem;" class="justify-center">
          <input type="button" class="primaryButton" value="Approve" @click="onDialogOK" v-close-popup>
          <input type="button" value="Reject" @click="onDialogCancel">
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
