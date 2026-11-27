<script setup lang="ts">
  // What a typed amount of a fungible token is worth at Cauldron's price, to read only: a pool's
  // price is no basis for deciding how many tokens leave the wallet, so no form takes fiat for one.
  // The line is there for any token with a price, also before an amount is typed, so the form
  // does not shift under the cursor. Where it sits is the form's own choice.
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { formatFiatAmount, parseTokenAmountToBigInt } from 'src/utils/utils'
  import { shownTokenFiatValue } from 'src/utils/defi/tokenFiatValue'

  const props = defineProps<{ category: string, typedAmount: string }>()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const hasValue = computed(() => shownTokenFiatValue(props.category, 0n) !== null);
  const value = computed(() => {
    if (!props.typedAmount.trim()) return undefined;
    const decimals = store.bcmrRegistries?.[props.category]?.token?.decimals ?? 0;
    let amount: bigint;
    try {
      amount = parseTokenAmountToBigInt(props.typedAmount, decimals);
    } catch {
      return undefined;
    }
    const fiatValue = shownTokenFiatValue(props.category, amount);
    if (fiatValue === null) return undefined;
    return formatFiatAmount(fiatValue, settingsStore.currency);
  });
</script>

<template>
  <div v-if="hasValue" class="tokenFiatValue">
    {{ t('wallet.tokenValueAtCauldron') }} <template v-if="value">≈ {{ value }}</template>
  </div>
</template>

<style scoped>
.tokenFiatValue {
  color: grey;
  font-size: smaller;
}
</style>
