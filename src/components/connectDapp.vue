<script setup lang="ts">
  import { ref, type Ref } from 'vue'
  import { useQuasar } from 'quasar';
  import { storeToRefs } from 'pinia';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useCashconnectStore } from 'src/stores/cashconnectStore';
  import { waitForInitialized } from 'src/utils/utils'
  import { type Wallet } from 'mainnet-js';

  // Components.
  import WalletconnectView from 'src/components/walletConnect.vue'
  import CashconnectView from 'src/components/cashConnect.vue'

  const $q = useQuasar();
  const store = useStore()
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

  // Handle Props.
  function isSessionRequest(uri: string): boolean {
    // Check if the URI contains the `?requestId=` parameter, which indicates a signing request
    const isSigningRequest = uri.includes("?requestId=");
    return !isSigningRequest;
  }

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

  // Methods.
  async function connectDappUriInput(){
    try {
      // Promise will wait for state indicating whether WC and CC are initialized
      const { isWcAndCcInitialized } = storeToRefs(store);
      await waitForInitialized(isWcAndCcInitialized); 

      // If the URL begings with "wc:" (walletconnect)...
      if(dappUriInput.value.startsWith('wc:')) {
        await walletconnectRef.value?.connectDappUriInput(dappUriInput.value);
      }

      // Otherwise, if the URL begins with "cc:" (cashconnect)...
      else if (dappUriInput.value.startsWith('cc:')) {
        await cashconnectRef.value?.connectDappUriInput(dappUriInput.value);
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
</script>

<template>
    <fieldset class="item">
      <legend>Connect to Dapp</legend>
      <div style="margin-bottom: 10px;">
        To explore: <a href="https://tokenaut.cash/dapps?filter=walletconnect" target="_blank">Tokenaut.cash</a> has the full list of BCH Dapps with WalletConnect
      </div>
      <input @keyup.enter="connectDappUriInput" v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem; margin-bottom: 5px">
        <input @click="connectDappUriInput" type="button" class="primaryButton" value="Connect New dApp">
      </div>
    </fieldset>

    <WalletconnectView ref="walletconnectRef"/>
    <CashconnectView ref="cashconnectRef" />
</template>
