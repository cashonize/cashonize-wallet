<script setup lang="ts">
  // The amount of a send as its confirm and success screens headline it, with the token's icon
  import { useSettingsStore } from 'src/stores/settingsStore'
  import type { SendSummary } from 'src/interfaces/interfaces'
  import TokenIcon from './TokenIcon.vue'
  const settingsStore = useSettingsStore()

  // compact is the confirm screen's size, beside the success screen's headline
  defineProps<{
    summary: SendSummary,
    compact?: boolean,
  }>()
</script>

<template>
  <div class="sendAmount" :class="{ compact }">
    <div class="amountRow">
      <TokenIcon
        v-if="summary.token"
        :token-id="summary.token.category"
        :icon-url="settingsStore.disableTokenIcons ? undefined : summary.token.iconUrl"
        :size="compact ? 32 : 40"
      />
      <div class="amount">{{ summary.amount }}<span v-if="summary.unit" class="unit">{{ summary.unit }}</span></div>
    </div>
    <div v-if="summary.fiat" class="fiat">≈ {{ summary.fiat }}</div>
  </div>
</template>

<style scoped>
  .sendAmount {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .amountRow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    max-width: 100%;
  }
  .amount {
    font-size: 38px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .amount .unit {
    font-size: 0.5em;
    font-weight: 600;
    color: var(--color-grey);
    letter-spacing: 0;
    margin-left: 6px;
  }
  .fiat {
    font-size: 18px;
    color: var(--color-grey);
  }
  .compact {
    align-items: flex-start;
  }
  .compact .amountRow {
    justify-content: flex-start;
    gap: 10px;
  }
  .compact .amount {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .compact .fiat {
    font-size: 15px;
  }
</style>
