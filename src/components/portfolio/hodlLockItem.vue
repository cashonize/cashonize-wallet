<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import InfoPopup from '../general/InfoPopup.vue'
  const { t } = useI18n()

  defineProps<{
    dotColor: string
    bchDisplay: string
    // undefined while the block height is unknown; the date is the (estimated) unlock time,
    // shown on hover
    unlock: { text: string, date: string | undefined } | undefined
    valueDisplay: string
    shareDisplay: string | undefined
  }>()
</script>

<!-- One hodl contract holding the wallet's BCH. The icon layers the hodl plugin's diamond
  mark over the BCH icon, like the Cauldron rows do with their mark.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <div class="hodl-icon">
      <img src="images/bch-icon.png" class="bch-icon">
      <span class="hodl-badge">💎</span>
    </div>
    <div class="asset-name">
      <div>{{ t('portfolio.hodlContract') }}</div>
      <div class="sub">{{ bchDisplay }}</div>
      <div v-if="unlock" class="sub">
        <InfoPopup v-if="unlock.date">
          <template #trigger>{{ unlock.text }}</template>
          <div>{{ unlock.date }}</div>
        </InfoPopup>
        <template v-else>{{ unlock.text }}</template>
      </div>
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
.hodl-icon {
  position: relative;
  width: 32px;
  height: 32px;
}
.bch-icon {
  width: 32px;
  height: 32px;
}
/* the diamond sits in the corner of the BCH icon, on a disc of page background to lift it
   off the icon it overlaps */
.hodl-badge {
  position: absolute;
  right: -10px;
  bottom: -5px;
  width: 20px;
  height: 20px;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  border-radius: 50%;
  background-color: var(--bg-color);
}
</style>
