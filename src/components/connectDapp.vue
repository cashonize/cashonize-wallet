<script setup lang="ts">
  import { ref, watch, type Ref } from 'vue'
  import { useQuasar } from 'quasar';
  import { storeToRefs } from 'pinia';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useCashconnectStore } from 'src/stores/cashconnectStore';
  import { waitForInitialized } from 'src/utils/utils'
  import { type Wallet } from 'mainnet-js';
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';

  // Components.
  import WalletconnectView from 'src/components/walletConnect.vue'
  import CashconnectView from 'src/components/cashConnect.vue'

  const $q = useQuasar();
  const store = useStore()
  const isBrowser = (process.env.MODE == "spa");

  const walletconnectStore = await useWalletconnectStore(store.wallet as Wallet )
  const web3wallet = walletconnectStore.web3wallet
  const { wallet } = storeToRefs(store);
  const cashconnectStore = await useCashconnectStore(wallet as Ref<Wallet>);

  // Props.
  const props = defineProps<{
    dappUriUrlParam?: string
  }>()

  // Component references.
  const walletconnectRef = ref<InstanceType<typeof WalletconnectView> | null>(null);
  const cashconnectRef = ref<InstanceType<typeof CashconnectView> | null>(null);

  // State.
  const dappUriInput = ref("");
  const showQrCodeDialog = ref(false);

  // Handle Props.
  function isSessionRequest(uri: string): boolean {
    // Check if the URI contains the `?requestId=` parameter, which indicates a signing request
    const isSigningRequest = uri.includes("?requestId=");
    return !isSigningRequest;
  }

  async function checkDappUriUrlParam(){
    if(props.dappUriUrlParam?.startsWith('wc:') && isSessionRequest(props.dappUriUrlParam)){
      try {
        await web3wallet?.core.pairing.pair({ uri: props.dappUriUrlParam });
      } catch (error) {
        console.error("Error pairing URI:", error);
      }
    }
    if(props.dappUriUrlParam?.startsWith('cc:')){
      await cashconnectStore.pair(props.dappUriUrlParam);
    }
  }
  // Check for dappUriUrlParam on component mount and watch for changes.
  await checkDappUriUrlParam()
  watch(props, async() => {
    await checkDappUriUrlParam()
  })

  // Methods.
  async function connectDappUriInput(dappUri: string) {
    try {
      // Promise will wait for state indicating whether WC and CC are initialized
      const { isWcAndCcInitialized } = storeToRefs(store);
      await waitForInitialized(isWcAndCcInitialized); 

      // If the URL begings with "wc:" (walletconnect)...
      if(dappUri.startsWith('wc:')) {
        await walletconnectRef.value?.connectDappUriInput(dappUri);
      }

      // Otherwise, if the URL begins with "cc:" (cashconnect)...
      else if (dappUri.startsWith('cc:')) {
        await cashconnectRef.value?.connectDappUriInput(dappUri);
      }

      // Otherwise, if it does not match CC or WC, throw an error.
      else {
        throw new Error('Invalid WalletConnect or CashConnect URL');
      }

      // Clear the input.
      dappUriInput.value = '';
    } catch(error) {
      $q.notify({
        message: `${error}`,
        icon: 'warning',
        color: 'negative'
      })
    }
  }

  const qrDecode = async (content: string) => {
    await connectDappUriInput(content)
  }
  const qrFilter = (content: string) => {
    const matchWalletConnect = String(content).match(/^wc:([0-9a-fA-F]{64})@(\d+)\?([a-zA-Z0-9\-._~%!$&'()*+,;=:@/?=&]*)$/i);
    const matchCashConnect = String(content).match(/^cc:([0-9a-fA-F]{64})@(\d+)\?([a-zA-Z0-9\-._~%!$&'()*+,;=:@/?=&]*)$/i);

    if (!matchWalletConnect && !matchCashConnect) {
      return "Not a valid WalletConnect or CashConnect URI";
    }
    return true;
}
</script>

<template>
    <fieldset class="item">
      <legend>Connect to Dapp</legend>
      <div style="margin-bottom: 10px;">
        To explore: <a href="https://tokenaut.cash/dapps?filter=walletconnect" target="_blank">Tokenaut.cash</a> has the full list of BCH Dapps with WalletConnect
      </div>
      <div style="display: flex; gap: 0.5rem; ">
        <input @keyup.enter="() => connectDappUriInput(dappUriInput)" v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
        <button v-if="isBrowser" @click="() => showQrCodeDialog = true" style="padding: 12px; height: 43px;">
          <img src="images/qrscan.svg" />
        </button>
      </div>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem; margin-bottom: 5px">
        <input @click="() => connectDappUriInput(dappUriInput)" type="button" class="primaryButton" value="Connect New dApp">
      </div>
    </fieldset>

    <WalletconnectView ref="walletconnectRef"/>
    <CashconnectView ref="cashconnectRef" />

    <div v-if="showQrCodeDialog">
      <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
    </div>
</template>
