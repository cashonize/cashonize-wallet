<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    category: string
    name: string
    // set when the receipt is included in the chart and total, undefined keeps a blank dot
    dotColor: string | undefined
    // undefined while the receipt commitment is still being parsed
    state: { stakedDisplay: string | undefined, epochDisplay: string | undefined } | undefined
    estimatedValueDisplay: string | undefined
    shareDisplay: string | undefined
  }>()
</script>

<!-- One ParyonUSD staking receipt row in the portfolio asset list.
  The stake recorded on the receipt can have been reduced since, so the value is
  displayed as an estimate and stays out of the chart and total.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <TokenIcon
      :token-id="category"
      :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(category) : undefined"
      :size="32"
    />
    <div class="asset-name">
      <div>{{ name }}</div>
      <div v-if="state?.stakedDisplay" class="sub">
        {{ t('portfolio.staked') }}: {{ state.stakedDisplay }}
      </div>
      <div v-if="state?.epochDisplay" class="sub">
        {{ t('portfolio.epoch') }}: {{ state.epochDisplay }}
      </div>
    </div>
    <div class="asset-value">
      <template v-if="!state">
        <q-spinner-dots size="1.2em" />
      </template>
      <template v-else-if="estimatedValueDisplay">
        <div class="sub">
          {{ t('portfolio.stakedValue') }}
          <InfoPopup>
            <div style="max-width: 260px;">{{ t('portfolio.stakingInfo') }}</div>
          </InfoPopup>
        </div>
        <div class="estimate">~ {{ estimatedValueDisplay }}</div>
        <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.estimate {
  font-style: italic;
  opacity: 0.75;
}
</style>
