
<script setup lang="ts">
  import { computed, type Ref } from 'vue'
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { type Wallet } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { storeToRefs } from 'pinia';
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'

  // Expose to 'connectDapp' parent component.
  defineExpose({
    connectDappUriInput
  });

  const $q = useQuasar()
  const store = useStore()
  const { t } = useI18n()

  const { _wallet } = storeToRefs(store);
  const walletconnectStore = useWalletconnectStore(_wallet as Ref<Wallet>, store.changeNetwork)
  // Note: web3wallet starts off undefined, so we want the reactive reference.
  const { web3wallet } = storeToRefs(walletconnectStore)

  const activeSessions = computed(() => walletconnectStore.activeSessions ?? {})

  async function connectDappUriInput(url: string){
    try {
      if(!url) throw(t('walletConnect.errors.enterUri'));
      // Note: the initialization is awaited when the function is used in the 'connectDapp' component.
      if(!web3wallet.value) throw(t('walletConnect.errors.notInitialized'));
      await web3wallet.value.core.pairing.pair({ uri: url });
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : t('walletConnect.errors.invalidUri')
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
    <legend>{{ t('walletConnect.sessions.title') }}</legend>

    <div v-for="sessionInfo in Object.values(activeSessions || {}).reverse()" :key="sessionInfo.topic" class="wc2sessions" >
      <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" :activeSessions="activeSessions" @delete-session="(arg) => walletconnectStore.deleteSession(arg)"/>
    </div>
    <!-- Show Empty Message if no Sessions are active -->
    <template v-if="!Object.keys(activeSessions || {}).length">
      <div class="q-pa-md">{{ t('walletConnect.sessions.noActiveSessions') }}</div>
    </template>

  </fieldset>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>
