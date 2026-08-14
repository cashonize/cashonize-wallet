<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { EMERALD_DAO_CATEGORY } from 'src/utils/emeraldDao'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    name: string
    dotColor: string
    serial: number
    valueDisplay: string
    shareDisplay: string | undefined
  }>()
</script>

<!-- One Emerald DAO keycard row in the portfolio asset list. The BCH backing the keycard is
  recorded on the keycard itself, so the value needs no lookup and is exact.
  Row styling comes from portfolioView's asset-list :deep() rules. -->
<template>
  <div class="asset-row">
    <span class="dot" :style="{ color: dotColor }"></span>
    <TokenIcon
      :token-id="EMERALD_DAO_CATEGORY"
      :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(EMERALD_DAO_CATEGORY) : undefined"
      :size="32"
    />
    <div class="asset-name">
      <div>{{ name }}</div>
      <div class="sub">{{ t('portfolio.keycardNumber', { serial }) }}</div>
    </div>
    <div class="asset-value">
      <div class="sub">
        {{ t('portfolio.lockedValue') }}
        <InfoPopup>
          <div style="max-width: 260px;">{{ t('portfolio.keycardInfo') }}</div>
        </InfoPopup>
      </div>
      <div>{{ valueDisplay }}</div>
      <div v-if="shareDisplay" class="sub">{{ shareDisplay }}</div>
    </div>
  </div>
</template>
