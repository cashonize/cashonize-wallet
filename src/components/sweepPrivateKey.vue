<script setup lang="ts">
  import { ref } from 'vue'
  import { TestNetWallet, Wallet } from 'mainnet-js';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { displayAndLogError } from 'src/utils/errorHandling';
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    wif: string | undefined
  }>()

  const privateKeyToSweep = ref(props.wif ?? "");
  const showQrCodeDialog = ref(false);

  async function sweep(){
    try {
      if(!privateKeyToSweep.value) {
        throw new Error("No private key WIF provided to sweep");
      }
      const wifToSweep = privateKeyToSweep.value.startsWith('bch-wif:') ? privateKeyToSweep.value.slice(8) : privateKeyToSweep.value;
      const walletClass = (store.network == 'mainnet')? Wallet : TestNetWallet;
      // TODO: is uncompressed WIF supported by mainnet-js?
      const tempWallet = await walletClass.fromWIF(wifToSweep);
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const mainWalletAddress = store.wallet.cashaddr
      await tempWallet.sendMax(mainWalletAddress)
      $q.notify({
        type: 'positive',
        message: `Successfully swept funds on Private Key`
      })
      privateKeyToSweep.value = "";
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history
      store.updateWalletHistory();
    } catch (error) {
      displayAndLogError(error);
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
      return "Not a QR code encoding a Private Key in WIF format";
    }
    if(store.network === 'mainnet' && !mainnetWifEncoding) {
      return "Not a QR code encoding a Mainnet Private Key in WIF format";
    }
    if(store.network === 'chipnet' && !chipnetWifEncoding) {
      return "Not a QR code encoding a Chipnet Private Key in WIF format";
    }
    return true;
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>Sweep Private Key</legend>

    Sweep BCH from a private key WIF:
    <div style="display: flex; gap: 0.5rem;">
      <input v-model="privateKeyToSweep" @keyup.enter="() => sweep()"  type="text" placeholder="Enter Private Key WIF" />
      <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
          <img src="images/qrscan.svg" />
      </button>
    </div>
    <input @click="sweep()" type="button" class="primaryButton" value="Sweep" style="margin-top: 8px;">
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>