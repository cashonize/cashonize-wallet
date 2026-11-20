<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useBexStore } from 'src/stores/bexStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useStore } from 'src/stores/store'
  import { autoApproveKey } from 'src/utils/bex/permissions'
  import DappSessionCard from 'src/components/general/dappSessionCard.vue'
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue'

  const bexStore = useBexStore()
  const settingsStore = useSettingsStore()
  const store = useStore()
  const { t } = useI18n()

  // As on WalletConnect, a single-address wallet's one account is the wallet itself and adds no
  // information to the card; an HD wallet's chosen accounts identify the connection.
  const showConnectedAddresses = computed(() => settingsStore.getWalletType(store.activeWalletName) === 'hd')

  const settingsOrigin = ref('')
</script>

<template>
  <div v-if="Object.keys(bexStore.activePermissions).length">
    <div class="sessions-section-heading">{{ t('dapp.browserProvider') }}</div>

    <div v-for="(permission, origin) in bexStore.activePermissions" :key="origin" class="bex-session-card">
      <DappSessionCard
        :dapp-metadata="bexStore.siteMetadata(origin, permission)"
        :connected-addresses="showConnectedAddresses ? permission.accounts : []"
        @settings="settingsOrigin = origin"
        @remove="bexStore.revokeOrigin(origin)"
      />

      <WC2SessionSettingsDialog
        v-if="settingsOrigin === origin"
        :session-id="autoApproveKey(origin)"
        hide-session-id
        :dapp-metadata="bexStore.siteMetadata(origin, permission)"
        :connected-addresses="showConnectedAddresses ? permission.accounts : []"
        @hide="settingsOrigin = ''"
      />
    </div>
  </div>
</template>

<style scoped>
  .bex-session-card {
    margin-top: 8px;
  }
</style>
