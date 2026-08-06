<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from '../general/TokenIcon.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    category: string
    name: string
    dotColor: string
    // undefined while the on-chain loan state is still being fetched
    state: { collateralDisplay: string | undefined, debtDisplay: string | undefined } | undefined
    netValueDisplay: string | undefined
    shareDisplay: string | undefined
  }>()
</script>

<!-- One ParyonUSD loan key row in the portfolio asset list.
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
      <div v-if="state?.collateralDisplay" class="sub">
        {{ t('portfolio.collateral') }}: {{ state.collateralDisplay }}
      </div>
      <div v-if="state?.debtDisplay" class="sub">
        {{ t('portfolio.debt') }}: {{ state.debtDisplay }}
      </div>
    </div>
    <div class="asset-value">
      <template v-if="!state">
        <q-spinner-dots size="1.2em" />
      </template>
      <template v-else-if="netValueDisplay">
        <div class="sub">{{ t('portfolio.netValue') }}</div>
        <div>{{ netValueDisplay }}</div>
        <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
      </template>
    </div>
  </div>
</template>
