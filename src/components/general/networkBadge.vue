<script setup lang="ts">
  // Marks a wallet on a test network next to its name, with what that network goes without.
  // Read from the settings and the network checks rather than listed, so a token metadata indexer
  // set for the network drops its line.
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { dappsAvailableOn } from 'src/utils/wallet/networks'
  import { cauldronAvailableOn } from 'src/utils/defi/cauldronApi'
  import InfoPopup from './InfoPopup.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // store.network throws while no wallet is set, as at startup
  const testNetwork = computed(() => {
    if (store._wallet === null || store.network === 'mainnet') return undefined
    return store.network
  })

  const unavailableFeatures = computed(() => {
    const network = testNetwork.value
    if (!network) return []
    const features: string[] = []
    if (!settingsStore.tokenMetadataIndexer[network]) features.push(t('networkBadge.unavailable.tokenMetadata'))
    if (!cauldronAvailableOn(network)) features.push(t('networkBadge.unavailable.cauldronPrices'))
    if (!dappsAvailableOn(network)) features.push(t('networkBadge.unavailable.dappConnections'))
    return features
  })
</script>

<template>
  <InfoPopup v-if="testNetwork">
    <template #trigger>
      <span class="network-badge" :class="testNetwork">{{ testNetwork }}</span>
    </template>
    <div>{{ t('networkBadge.intro', { network: testNetwork }) }}</div>
    <div v-if="unavailableFeatures.length" class="info-popup-note">
      {{ t('networkBadge.unavailableHeading', { network: testNetwork }) }}
      <ul class="network-badge-list">
        <li v-for="feature in unavailableFeatures" :key="feature">{{ feature }}</li>
      </ul>
    </div>
  </InfoPopup>
</template>

<style scoped>
.network-badge {
  display: inline-block;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  color: #fff;
  cursor: pointer;
  user-select: none;
}
/* chipnet is the usual test network and has every backend, testnet4 goes without several */
.network-badge.chipnet {
  background: #8a8a8a;
}
.network-badge.testnet4 {
  background: #d97706;
}
.network-badge-list {
  margin: 4px 0 0 0;
  padding-left: 18px;
}
</style>
