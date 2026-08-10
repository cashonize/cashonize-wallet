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
    dotColor: string
    bchDisplay: string
    tokenDisplay: string
    valueDisplay: string
    shareDisplay: string | undefined
  }>()
</script>

<!-- One Cauldron liquidity pool row in the portfolio asset list. A pool holds BCH next to its
  token, so the icon layers the Cauldron mark over the token icon and both sides are listed.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <div class="pool-icon">
      <TokenIcon
        :token-id="category"
        :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(category) : undefined"
        :size="32"
      />
      <img class="pool-badge" src="images/cauldronGreen.svg">
    </div>
    <div class="asset-name">
      <div>{{ name }}</div>
      <div class="sub">{{ t('portfolio.cauldronPool') }}</div>
      <div class="sub">{{ bchDisplay }} + {{ tokenDisplay }}</div>
    </div>
    <div class="asset-value">
      <div class="sub">
        {{ t('portfolio.poolValue') }}
        <InfoPopup>
          <div style="max-width: 260px;">{{ t('portfolio.poolInfo') }}</div>
        </InfoPopup>
      </div>
      <div>{{ valueDisplay }}</div>
      <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
    </div>
  </div>
</template>

<style scoped>
.pool-icon {
  position: relative;
  width: 32px;
  height: 32px;
}
/* The Cauldron mark sits in the corner of the token icon, in Cauldron's own colors: their
   green on the dark background they show it on. The ring of page background lifts the badge
   off the icon it overlaps. */
.pool-badge {
  position: absolute;
  right: -10px;
  bottom: -5px;
  width: 20px;
  height: 20px;
  padding: 2px;
  border-radius: 50%;
  background-color: #0b1321;
  box-shadow: 0 0 0 2px var(--bg-color);
}
</style>
