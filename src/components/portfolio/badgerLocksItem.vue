<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'
  import { BADGERCOIN_CATEGORY } from 'src/utils/defi/badgersStake'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    dotColor: string
    // undefined while the block height is unknown or the lock is still unconfirmed
    unlockDisplay: string | undefined
    valueDisplay: string
    shareDisplay: string | undefined
  }>()
</script>

<!-- One lock of the wallet's BCH in the Badgers.cash contract.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <TokenIcon
      :token-id="BADGERCOIN_CATEGORY"
      :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(BADGERCOIN_CATEGORY) : undefined"
      :size="32"
    />
    <div class="asset-name">
      <div>{{ t('portfolio.badgersStake') }}</div>
      <div v-if="unlockDisplay" class="sub">{{ unlockDisplay }}</div>
    </div>
    <div class="asset-value">
      <div class="sub">
        {{ t('portfolio.lockedBch') }}
        <InfoPopup>
          <div style="max-width: 260px;">{{ t('portfolio.badgersInfo') }}</div>
        </InfoPopup>
      </div>
      <div>{{ valueDisplay }}</div>
      <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
    </div>
  </div>
</template>
