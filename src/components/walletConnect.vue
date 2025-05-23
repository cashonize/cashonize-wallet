
<script setup lang="ts">
  import { computed, type Ref } from 'vue'
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { type Wallet } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { storeToRefs } from 'pinia';
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useQuasar } from 'quasar'
  
  defineExpose({
    connectDappUriInput
  });
  
  const $q = useQuasar()
  const store = useStore()

  const { wallet } = storeToRefs(store);
  const walletconnectStore = await useWalletconnectStore(wallet as Ref<Wallet>, store.changeNetwork)
  const web3wallet = walletconnectStore.web3wallet

  const activeSessions = computed(() => walletconnectStore.activeSessions ?? {})

  async function connectDappUriInput(url: string){
    try {
      if(!url) throw("Enter a BCH WalletConnect URI");
      await web3wallet?.core.pairing.pair({ uri: url });
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : "Not a valid BCH WalletConnect URI"
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof error == 'string' ? "grey-7" : "red"
      })
    }
  }
</script>

<template>
  <fieldset class="item">
    <legend>WalletConnect Sessions</legend>

    <div v-for="sessionInfo in Object.values(activeSessions || {}).reverse()" :key="sessionInfo.topic" class="wc2sessions" >
      <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" :activeSessions="activeSessions" @delete-session="(arg) => walletconnectStore.deleteSession(arg)"/>
    </div>
    <!-- Show Empty Message if no Sessions are active -->
    <template v-if="!Object.keys(activeSessions || {}).length">
      <div class="q-pa-md">No sessions currently active.</div>
    </template>
    
  </fieldset>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>
