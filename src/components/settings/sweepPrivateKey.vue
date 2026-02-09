<script setup lang="ts">
  import { ref } from 'vue'
  import { TestNetWallet, Wallet } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { displayAndLogError } from 'src/utils/errorHandling';
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import { useI18n } from 'vue-i18n'

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    wif: string | undefined
  }>()

  const privateKeyToSweep = ref(props.wif ?? "");
  const showQrCodeDialog = ref(false);
  const isSweeping = ref(false);

  async function sweep(){
    if (isSweeping.value) return;
    isSweeping.value = true;
    try {
      if(!privateKeyToSweep.value) {
        throw new Error(t('sweepPrivateKey.notifications.noWifProvided'));
      }
      const wifToSweep = privateKeyToSweep.value.startsWith('bch-wif:') ? privateKeyToSweep.value.slice(8) : privateKeyToSweep.value;
      const walletClass = (store.network == 'mainnet')? Wallet : TestNetWallet;
      // TODO: is uncompressed WIF supported by mainnet-js?
      const tempWallet = await walletClass.fromWIF(wifToSweep);
      $q.notify({
        spinner: true,
        message: t('sweepPrivateKey.notifications.sendingTransaction'),
        color: 'grey-5',
        timeout: 1000
      })
      const mainWalletAddress = store.wallet.getDepositAddress()
      await tempWallet.sendMax(mainWalletAddress)
      $q.notify({
        type: 'positive',
        message: t('sweepPrivateKey.notifications.success')
      })
      privateKeyToSweep.value = "";
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isSweeping.value = false;
    }
  }

  const qrDecode = (content: string) => {
    const decodedContent = content.startsWith('bch-wif:') ? content.slice(8) : content
    privateKeyToSweep.value = decodedContent;
  }
  const qrFilter = (content: string) => {
    // see https://documentation.cash/protocol/blockchain/encoding/base58check.html#version-bytes
    const mainnetWifEncoding = content.startsWith('bch-wif:') || content.startsWith('K') || content.startsWith('L') || content.startsWith('5')
    const chipnetWifEncoding = content.startsWith('c') || content.startsWith('9')
    if(!mainnetWifEncoding && !chipnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notWif');
    }
    if(store.network === 'mainnet' && !mainnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notMainnetWif');
    }
    if(store.network === 'chipnet' && !chipnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notChipnetWif');
    }
    return true;
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('sweepPrivateKey.title') }}</legend>

    {{ t('sweepPrivateKey.description') }}
    <div style="display: flex; gap: 0.5rem;">
      <input v-model="privateKeyToSweep" @keyup.enter="() => sweep()"  type="text" :placeholder="t('sweepPrivateKey.placeholder')" />
      <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
          <img src="images/qrscan.svg" />
      </button>
    </div>
    <input @click="sweep()" type="button" class="primaryButton" :value="isSweeping ? t('sweepPrivateKey.sweepingButton') : t('sweepPrivateKey.sweepButton')" style="margin-top: 8px;" :disabled="isSweeping">
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>