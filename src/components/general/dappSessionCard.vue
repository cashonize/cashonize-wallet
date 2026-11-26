<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { DappMetadata } from 'src/interfaces/interfaces'
  import { sanitizeUrl } from 'src/utils/utils'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWindowSize } from 'src/utils/composables'

  // One dApp's card, as the WalletConnect sessions and the browser provider both show it: its icon,
  // name, the URL it is connected with, what it says about itself and the accounts it holds, with
  // its settings and disconnect icons. The caller acts on those and hosts the settings dialog.
  const props = defineProps<{
    dappMetadata: DappMetadata
    // a WalletConnect session id when two sessions share a dApp's name; a browser-provider site
    // is told apart by its origin instead
    nameSuffix?: string | undefined
    connectedAddresses: string[]
  }>()

  const emit = defineEmits<{ settings: [], remove: [] }>()

  const settingsStore = useSettingsStore()
  const { width } = useWindowSize()
  const { t } = useI18n()

  const safeUrl = computed(() => sanitizeUrl(props.dappMetadata.url))

  function shortenAddress(address: string) {
    const addrWithoutPrefix = address.split(':')[1] ?? ''
    return addrWithoutPrefix.slice(0, 10) + '...' + addrWithoutPrefix.slice(-8)
  }
</script>

<template>
  <div class="dapp-session-card">
    <img v-if="dappMetadata.icons[0]" class="dapp-session-icon" :src="dappMetadata.icons[0]">
    <div class="dapp-session-details">
      <div class="dapp-session-name">{{ dappMetadata.name + (nameSuffix ?? '') }}</div>
      <a v-if="safeUrl" :href="safeUrl" target="_blank" rel="noopener noreferrer" class="dapp-session-url">{{ dappMetadata.url }}</a>
      <span v-else class="dapp-session-unsafe-url">{{ t('common.unsafeUrl') }}</span>
      <div class="dapp-session-description">{{ dappMetadata.description }}</div>
      <div v-for="addr in connectedAddresses" :key="addr" class="connected-address mono" :title="addr">
        <template v-if="width < 550">{{ shortenAddress(addr) }}</template>
        <template v-else>{{ addr }}</template>
      </div>
    </div>
    <div class="dapp-session-actions">
      <img
        class="dapp-session-settings"
        :alt="t('walletConnect.sessionSettings.title')"
        :title="t('walletConnect.sessionSettings.title')"
        :src="settingsStore.darkMode ? 'images/settingsLightGrey.svg' : 'images/settings.svg'"
        @click="emit('settings')"
      >
      <img
        class="dapp-session-remove"
        :alt="t('dapp.disconnect')"
        :title="t('dapp.disconnect')"
        :src="settingsStore.darkMode ? 'images/trashLightGrey.svg' : 'images/trash.svg'"
        @click="emit('remove')"
      >
    </div>
  </div>
</template>

<style scoped>
  .dapp-session-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px;
  }
  .dapp-session-icon {
    height: 54px;
    width: 54px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  /* min-width lets the details shrink inside the flex row; the dapp's name, url and description
     are its own and can hold long unbroken strings */
  .dapp-session-details {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* wrapped rather than cut off: the end of the url is what tells a dapp's domain from a
     lookalike, and preview deployment urls run long */
  .dapp-session-url {
    display: block;
    font-size: 13px;
  }
  .dapp-session-unsafe-url,
  .dapp-session-description {
    font-size: 13px;
  }
  .dapp-session-unsafe-url {
    color: var(--color-error);
  }
  .dapp-session-actions {
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex-shrink: 0;
  }
  .dapp-session-settings,
  .dapp-session-remove {
    cursor: pointer;
    max-width: none;
  }
  .connected-address {
    color: #888;
    font-size: 12px;
    margin-top: 2px;
  }
  .mono {
    font-family: monospace;
  }
  @media only screen and (max-width: 480px) {
    .dapp-session-card {
      gap: 10px;
    }
  }
</style>
