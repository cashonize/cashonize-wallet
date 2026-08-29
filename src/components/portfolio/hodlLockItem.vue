<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import InfoPopup from '../general/InfoPopup.vue'
  const { t } = useI18n()

  defineProps<{
    dotColor: string
    // undefined while the block height is unknown
    unlockDisplay: string | undefined
    valueDisplay: string
    shareDisplay: string | undefined
  }>()
</script>

<!-- One hodl contract holding the wallet's BCH.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <img src="images/bch-icon.png" class="bch-icon">
    <div class="asset-name">
      <div>{{ t('portfolio.hodlContract') }}</div>
      <div v-if="unlockDisplay" class="sub">{{ unlockDisplay }}</div>
    </div>
    <div class="asset-value">
      <div class="sub">
        {{ t('portfolio.lockedBch') }}
        <InfoPopup>
          <div style="max-width: 260px;">{{ t('portfolio.hodlInfo') }}</div>
        </InfoPopup>
      </div>
      <div>{{ valueDisplay }}</div>
      <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
    </div>
  </div>
</template>

<style scoped>
.bch-icon {
  width: 32px;
  height: 32px;
}
</style>
