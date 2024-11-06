<script setup lang="ts">
  import { ref } from 'vue'
  import { storeToRefs } from 'pinia'
  import { useQuasar } from 'quasar';
  import { useStore } from 'src/stores/store'
  import { waitForInitialized } from 'src/utils/utils'
  const store = useStore()

  // Components.
  import WalletconnectView from 'src/components/walletConnect.vue'
  import CashconnectView from 'src/components/cashConnect.vue'

  const $q = useQuasar();

  // Props.
  defineProps<{
    dappUriUrlParam?: string
  }>()

  // Component references.
  const walletconnectRef = ref<InstanceType<typeof WalletconnectView> | null>(null);
  const cashconnectRef = ref<InstanceType<typeof CashconnectView> | null>(null);

  // State.
  const dappUriInput = ref("");

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

    <WalletconnectView ref="walletconnectRef" :dappUriUrlParam="dappUriUrlParam"/>
    <CashconnectView ref="cashconnectRef" />
</template>
