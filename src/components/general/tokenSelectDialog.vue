<script setup lang="ts">
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { formatNumber } from 'src/utils/utils'
  import TokenIcon from 'src/components/general/TokenIcon.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    title: string,
    hint: string,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()

  // The full token list rather than the filtered one: hiding a token from the overview
  // is about the overview, it should not keep the user from requesting that token
  const fungibleTokens = computed(() =>
    store.tokenList?.filter(tokenData => 'amount' in tokenData) ?? []
  );

  function metadataFor(category: string) {
    return store.bcmrRegistries?.[category];
  }

  function tokenName(category: string) {
    return metadataFor(category)?.name ?? `${category.slice(0, 10)}...${category.slice(-8)}`;
  }

  function heldAmount(category: string, amount: bigint) {
    const decimals = metadataFor(category)?.token?.decimals ?? 0;
    const amountInTokens = decimals ? Number(amount) / (10 ** decimals) : Number(amount);
    const symbol = metadataFor(category)?.token?.symbol ?? "";
    return `${formatNumber(amountInTokens, decimals)} ${symbol}`.trim();
  }
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ title }}</legend>
        <div>{{ hint }}</div>
        <div v-if="!fungibleTokens.length" class="no-tokens">{{ t('requestPayment.noFungibleTokens') }}</div>
        <div v-else class="token-list">
          <div
            v-for="tokenData in fungibleTokens"
            :key="tokenData.category"
            class="token-item"
            :title="tokenData.category"
            @click="onDialogOK(tokenData.category)"
          >
            <TokenIcon
              :token-id="tokenData.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(tokenData.category) : undefined"
            />
            <div class="token-info">
              <div class="token-name">{{ tokenName(tokenData.category) }}</div>
              <div class="token-amount">
                {{ 'amount' in tokenData ? heldAmount(tokenData.category, tokenData.amount) : '' }}
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.dialogFieldset {
  padding: 2rem;
  width: 550px;
  max-width: 100%;
}
.no-tokens {
  opacity: 0.6;
  margin-top: 10px;
}
.token-list {
  max-height: 350px;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 10px;
}
/* neutral grey alphas keep the cards theme-agnostic, same as the address list */
.token-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.token-item:hover {
  background-color: rgba(128, 128, 128, 0.14);
}
.token-info {
  min-width: 0;
}
.token-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-amount {
  font-size: 0.85em;
  opacity: 0.65;
}
</style>
