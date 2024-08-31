<script setup lang="ts">
  import { ref } from 'vue'
  import { useQuasar } from 'quasar';

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
      // If the URL begings with "wc:" (walletconnect)...
      if(dappUriInput.value.startsWith('wc:')) {
        await walletconnectRef.value.connectDappUriInput(dappUriInput.value);
      }

      // Otherwise, if the URL begins with "cc:" (cashconnect)...
      else if (dappUriInput.value.startsWith('cc:')) {
        await cashconnectRef.value.connectDappUriInput(dappUriInput.value);
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
      <input v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem;">
        <input @click="connectDappUriInput" type="button" class="primaryButton" id="connect" value="Connect New dApp">
      </div>
    </fieldset>

    <WalletconnectView ref="walletconnectRef" :dappUriUrlParam="dappUriUrlParam"/>
    <CashconnectView ref="cashconnectRef" />
</template>
