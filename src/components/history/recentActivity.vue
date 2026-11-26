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
  // Rows that carry a token amount wait for the metadata it is read with, the decimals above all:
  // the held tokens' own load, and the fetch for tokens that only the history still names
  const recentTransactions = computed(() => {
    const recent = store.walletHistory?.slice(0, recentCount);
    const tokenMetadataPending = !store.tokenMetadataLoaded || store.historyMetadataFetches > 0;
    if (tokenMetadataPending && recent?.some(transaction => transaction.tokenAmountChanges.length)) return undefined;
    return recent;
  });
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
  <div class="recentActivity">
    <div class="recentHeader">
      <span>{{ t('history.recentActivity') }}</span>
      <button v-if="recentTransactions?.length" type="button" class="recentAll" @click="store.changeView(3)">
        {{ t('nav.history') }} <q-icon name="chevron_right" size="18px" />
      </button>
    </div>
    <!-- the list keeps the height of its rows whatever it holds, so the page does not grow as the
         history arrives: rows of bars while it loads, and the room left free in a wallet with fewer -->
    <div class="recentList">
    <template v-if="!recentTransactions">
      <div v-for="row in recentCount" :key="row" class="recentItem">
        <span class="tx-direction placeholderMark"></span>
        <span class="recentInfo">
          <span class="recentType"><span class="placeholder-bar" style="width: 5em;"></span></span>
          <span class="recentTime"><span class="placeholder-bar" style="width: 9em;"></span></span>
        </span>
        <span class="recentBch"><span class="placeholder-bar" style="width: 7em;"></span></span>
      </div>
    </template>
    <div v-else-if="!recentTransactions.length" class="recentEmpty">{{ t('history.noTransactions') }}</div>
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
/* three rows of two lines of text and their padding */
.recentList {
  min-height: 204px;
}
.recentEmpty {
  padding: 10px 4px;
  color: grey;
}
.placeholderMark {
  background-color: var(--surface-strong);
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
button.recentItem:hover {
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
