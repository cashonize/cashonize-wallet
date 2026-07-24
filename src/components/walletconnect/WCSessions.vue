
<script setup lang="ts">
  import { computed } from 'vue'
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useI18n } from 'vue-i18n'

  const { t } = useI18n()

  const walletconnectStore = useWalletconnectStore()

  const activeSessions = computed(() => walletconnectStore.activeSessions ?? {})
</script>

<template>
  <!-- Section inside the shared 'dApp Sessions' fieldset (connectDapp.vue); hidden when empty -->
  <div v-if="Object.keys(activeSessions || {}).length">
    <div class="sessions-section-heading">{{ t('walletConnect.sessions.title') }}</div>

    <div v-for="sessionInfo in Object.values(activeSessions || {}).reverse()" :key="sessionInfo.topic" class="wc2sessions" >
      <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" :activeSessions="activeSessions" @delete-session="(arg) => walletconnectStore.deleteSession(arg)"/>
    </div>
  </div>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>
