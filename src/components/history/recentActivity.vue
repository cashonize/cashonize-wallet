<script setup lang="ts">
  // The newest transactions, on the wallet page: a short look at the history, each row opening the
  // same details the history view does. It reads the page of history the wallet loads as it
  // opens, and asks for no more.
  import { computed, ref } from 'vue'
  import type { TransactionHistoryItem } from '@cashonize/bch-wallet-lib'
  import { useStore } from 'src/stores/store'
  import { formatTime, formatBchAmount, tokenChangeChips, dayLabel } from 'src/utils/utils'
  import { txDirection, directionIcon, isSelfSend } from 'src/utils/history/txDirection'
  import TransactionDialog from './transactionDialog.vue'
  import TokenIcon from '../general/TokenIcon.vue'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const recentCount = 3;
  const recentTransactions = computed(() => store.walletHistory?.slice(0, recentCount));
  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);

  const bchDisplayUnit = computed(() => store.network === "mainnet" ? "BCH" : "tBCH");
  const walletHasAddress = (address: string) => store.walletHasAddress(address);

  function directionLabel(transaction: TransactionHistoryItem): string {
    if (isSelfSend(transaction, walletHasAddress)) return t('history.selfSend');
    return t('history.' + txDirection(transaction));
  }
  function timeLabel(transaction: TransactionHistoryItem): string {
    if (!transaction.timestamp) return t('history.pending');
    return `${dayLabel(transaction.timestamp)}, ${formatTime(transaction.timestamp)}`;
  }
</script>

<template>
  <div v-if="recentTransactions" class="recentActivity">
    <div class="recentHeader">
      <span>{{ t('history.recentActivity') }}</span>
      <button v-if="recentTransactions.length" type="button" class="recentAll" @click="store.changeView(3)">
        {{ t('nav.history') }} <q-icon name="chevron_right" size="18px" />
      </button>
    </div>
    <div v-if="!recentTransactions.length" class="recentEmpty">{{ t('history.noTransactions') }}</div>
    <button
      v-for="transaction in recentTransactions"
      :key="transaction.hash"
      type="button"
      class="recentItem"
      @click="selectedTransaction = transaction"
    >
      <span class="tx-direction" :class="[txDirection(transaction), { pending: !transaction.timestamp }]">
        <q-icon :name="directionIcon(transaction, isSelfSend(transaction, walletHasAddress))" size="20px" />
      </span>
      <span class="recentInfo">
        <span class="recentType">{{ directionLabel(transaction) }}</span>
        <span class="recentTime">{{ timeLabel(transaction) }}</span>
      </span>
      <span class="recentBch" :class="transaction.valueChange < 0 ? 'negative' : 'positive'">
        {{ formatBchAmount(transaction.valueChange, true) }} {{ bchDisplayUnit }}
      </span>
      <span v-if="transaction.tokenAmountChanges.length" class="recentTokens">
        <span class="token-chip" v-for="chip in tokenChangeChips(transaction, store.bcmrRegistries)" :key="chip.key">
          <TokenIcon
            :token-id="chip.category"
            :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(chip.category) : undefined"
            :size="22"
          />
          <span class="recentChipAmount" :class="chip.negative ? 'negative' : 'positive'">{{ chip.amountText }}</span>
          <span class="chip-symbol">{{ chip.symbol }}</span>
        </span>
      </span>
    </button>
  </div>

  <TransactionDialog
    v-if="selectedTransaction"
    :history-item="selectedTransaction"
    @hide="() => {selectedTransaction = undefined}">
  </TransactionDialog>
</template>

<style scoped>
.recentActivity {
  margin-top: 24px;
}
.recentHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-weight: 600;
}
/* a quiet link to the whole history, not chota's grey button */
.recentAll {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 4px 0 4px 8px;
  border: none;
  background: none;
  color: var(--font-color);
  font-weight: 500;
  opacity: 0.75;
}
.recentEmpty {
  color: grey;
}
.recentItem {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  width: 100%;
  margin: 0;
  padding: 10px 4px;
  border: none;
  border-radius: 0;
  background: none;
  color: var(--font-color);
  line-height: inherit;
  text-align: left;
}
.recentItem + .recentItem {
  border-top: 1px solid var(--surface-line);
}
.recentItem:hover {
  opacity: 1;
  background: var(--surface-strong);
}
.recentItem:active:not(:disabled) {
  transform: none;
}
.recentInfo {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.recentType {
  font-weight: 600;
}
.recentTime {
  font-size: 0.85em;
  opacity: 0.65;
}
.recentBch {
  margin-left: auto;
  font-family: monospace;
  text-align: right;
  white-space: nowrap;
}
/* the token chips take a line of their own under the row, at its right end */
.recentTokens {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.recentChipAmount {
  font-family: monospace;
  white-space: nowrap;
}
.positive {
  color: var(--color-primary);
}
.negative {
  color: rgb(188, 30, 30);
}
body.dark .negative {
  color: #ef9a9a;
}
</style>
