<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import type { Utxo } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { formatBchAmount } from 'src/utils/utils'
  import { outpointOf } from 'src/utils/wallet/reservedUtxos'
  import { addressFromUri } from 'src/utils/payments/bip21'
  import { validateRecipientAddress, getCashAddressScanError } from 'src/utils/payments/recipientAddress'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue'

  const props = defineProps<{ utxo: Utxo }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const destinationInput = ref("");
  const showQrCodeDialog = ref(false);

  // Read from the store rather than passed in, so the note follows the coin's live state
  const isFrozen = computed(() => store.reservedUtxos[outpointOf(props.utxo)]?.reason === 'manual');
  const bchDisplayUnit = computed(() => store.network === "mainnet" ? "BCH" : "tBCH");
  const networkPrefix = computed(() => store.network === 'mainnet' ? 'bitcoincash' : 'bchtest');
  // Same shortened shape the utxo lists show, the full txid is in the title attribute
  const truncatedOutpoint = computed(() =>
    `${props.utxo.txid.slice(0, 8)}...${props.utxo.txid.slice(-6)}:${props.utxo.vout}`
  );

  // The dialog only validates and hands back the address, the send itself is the caller's
  function confirmSend() {
    try {
      onDialogOK(validateRecipientAddress(destinationInput.value, networkPrefix.value));
    } catch (error) {
      displayAndLogError(error);
    }
  }

  const qrDecode = (content: string) => {
    destinationInput.value = addressFromUri(content);
  }
  const qrFilter = (content: string) => {
    return getCashAddressScanError(content, networkPrefix.value) ?? true;
  }
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('utxoManagement.send.title') }}</legend>
        <div class="utxo-line">
          <span class="utxo-amount">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }} {{ bchDisplayUnit }}</span>
          <span class="mono muted" :title="utxo.txid">{{ truncatedOutpoint }}</span>
        </div>
        <div>{{ t('utxoManagement.send.description') }}</div>
        <div v-if="isFrozen" class="frozen-note">
          <q-icon name="ac_unit" size="15px" />
          <span>{{ t('utxoManagement.send.frozenNote') }}</span>
        </div>
        <label>{{ t('utxoManagement.send.destinationLabel') }}</label>
        <div class="destination-input-row">
          <input
            v-model="destinationInput"
            type="text"
            :placeholder="t('utxoManagement.send.destinationPlaceholder')"
          >
          <button
            v-if="settingsStore.qrScan"
            @click="() => showQrCodeDialog = true"
            style="padding: 12px"
          >
            <img :src="settingsStore.darkMode ? 'images/qrscanLightGrey.svg' : 'images/qrscan.svg'" />
          </button>
        </div>
        <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
          <input type="button" class="primaryButton" :value="t('common.actions.send')" :disabled="!destinationInput" @click="confirmSend">
          <input type="button" :value="t('utxoManagement.send.cancelButton')" @click="onDialogCancel">
        </div>
      </fieldset>
      <div v-if="showQrCodeDialog">
        <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
      </div>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 2rem;
    width: 500px;
    max-width: 100%;
  }
  .utxo-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .utxo-amount {
    font-weight: bold;
  }
  .frozen-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    color: var(--color-primary);
  }
  label {
    display: block;
    margin-top: 15px;
  }
  .destination-input-row {
    display: flex;
    gap: 0.5rem;
  }
  .destination-input-row input {
    flex: 1;
    min-width: 0;
  }
  .mono {
    font-family: monospace;
  }
  .muted {
    color: var(--color-grey);
  }
</style>
