<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { computed, ref, watch, nextTick, onActivated, onDeactivated } from 'vue';
  import type { TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import { formatTime, formatFiatAmount, formatBchAmount, tokenChangeChips, dayLabel, localDayStart } from 'src/utils/utils';
  import { historyToCsv } from 'src/utils/history/csvUtils';
  import { maxTxNoteLength } from 'src/utils/history/txNotes';
  import { txDirection, directionIcon, isCombined, isDappInteraction } from 'src/utils/history/txDirection';
  import { isBelowRelayFee } from 'src/utils/history/txFeeRate';
  import TokenIcon from '../general/TokenIcon.vue';
  import InfoPopup from '../general/InfoPopup.vue';
  import InlineTextEdit from '../general/InlineTextEdit.vue';
  import { useI18n } from 'vue-i18n'
  import { exportFile, useQuasar } from 'quasar'

  const store = useStore()

  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const $q = useQuasar()
  const isCapacitor = import.meta.env.QUASAR_CAPACITOR_MODE;
  const itemsPerPage = 100

  // state options menu
  const showOptions = ref(false)
  const showFiatValue = ref(settingsStore.showFiatValueHistory)
  const showBalance = ref(settingsStore.showBalanceInHistory)
  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions" | "dappTransactions");
  const directionFilter = ref("all" as "all" | "incoming" | "outgoing" | "combined");
  const dateFrom = ref("");
  const dateTo = ref("");
  const searchQuery = ref("");
  const searchInputRef = ref<HTMLInputElement | null>(null);
  // On mobile the search input hides behind a search icon until toggled open
  const showSearch = ref(false);

  async function toggleSearch() {
    if (showSearch.value) {
      showSearch.value = false;
      searchQuery.value = "";
      return;
    }
    showSearch.value = true;
    // the input is behind a v-if, wait for the DOM update before focusing it
    await nextTick();
    searchInputRef.value?.focus();
  }

  const directionOptions = [
    { value: "all", label: "history.directionFilter.all" },
    { value: "incoming", label: "history.directionFilter.incoming" },
    { value: "outgoing", label: "history.directionFilter.outgoing" },
    { value: "combined", label: "history.directionFilter.combined" },
  ] as const;

  const currentPage = ref(1)
  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);

  // Override Ctrl+F to focus the search input.
  function handleCtrlF(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      showSearch.value = true;
      // the input is behind a v-if, wait for the DOM update before focusing it
      void nextTick().then(() => searchInputRef.value?.focus());
    }
  }

  // Listener added/removed on KeepAlive activate/deactivate so it only applies while this view is active.
  onActivated(() => document.addEventListener('keydown', handleCtrlF));
  onDeactivated(() => document.removeEventListener('keydown', handleCtrlF));

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  // An operation on one of the wallet's own identities, named rather than left reading as a
  // self-send with an OP_RETURN attached
  function identityOperation(transaction: TransactionHistoryItem) {
    // a transaction on a listed identity's chain is an operation on it; whether it published
    // metadata is told by the walk, which read the BCMR output a history item cannot see
    const identity = (identitiesStore.identities ?? []).find(listed => listed.recentLinks?.includes(transaction.hash));
    if (!identity) return undefined;
    const kind = identitiesStore.identityPublicationTxids.includes(transaction.hash) ? 'metadataUpdate' : 'identityOperation';
    const name = store.bcmrRegistries?.[identity.category]?.name;
    return name ? t(`history.identity.${kind}Named`, { name }) : t(`history.identity.${kind}`);
  }

  // Predicate for isDappInteraction, which is store-agnostic by design
  const walletHasAddress = (address: string) => store.walletHasAddress(address);

  // Show confirmation progress toward the customary 6, after that a transaction
  // is considered final and the count is no longer interesting
  function confirmationsProgress(transaction: TransactionHistoryItem): number | undefined {
    if (!transaction.timestamp || transaction.blockHeight <= 0) return undefined;
    if (store.currentBlockHeight === undefined) return undefined;
    const confirmations = Math.max(1, store.currentBlockHeight - transaction.blockHeight + 1);
    return confirmations < 6 ? confirmations : undefined;
  }

  const selectedHistory = computed(() => {
    let history = store.walletHistory;
    if (selectedFilter.value === "bchTransactions") history = history?.filter(tx => !tx.tokenAmountChanges.length);
    if (selectedFilter.value === "tokenTransactions") history = history?.filter(tx => tx.tokenAmountChanges.length);
    if (selectedFilter.value === "dappTransactions") history = history?.filter(tx => isDappInteraction(tx, walletHasAddress));
    // The direction pills partition the history: each one shows exactly the rows
    // carrying that label, so combined transactions only appear under Combined
    if (directionFilter.value === "incoming") history = history?.filter(tx => txDirection(tx) === 'received');
    if (directionFilter.value === "outgoing") history = history?.filter(tx => txDirection(tx) === 'sent');
    if (directionFilter.value === "combined") history = history?.filter(tx => isCombined(tx));
    const fromTimestamp = dateFrom.value ? localDayStart(dateFrom.value) : undefined;
    const untilTimestamp = dateTo.value ? localDayStart(dateTo.value, 1) : undefined;
    if (fromTimestamp !== undefined || untilTimestamp !== undefined) {
      // Pending transactions have no timestamp yet, treat them as happening now
      history = history?.filter(tx => {
        const txTimestamp = tx.timestamp ?? Date.now() / 1000;
        if (fromTimestamp !== undefined && txTimestamp < fromTimestamp) return false;
        if (untilTimestamp !== undefined && txTimestamp >= untilTimestamp) return false;
        return true;
      });
    }
    return history;
  });

  function txMatchesSearch(tx: TransactionHistoryItem, query: string): boolean {
    if (tx.hash.toLowerCase().includes(query)) return true;
    if (store.txNotes[tx.hash]?.toLowerCase().includes(query)) return true;
    return tx.tokenAmountChanges.some(tokenChange => {
      if (tokenChange.category.toLowerCase().includes(query)) return true;
      const metadata = store.bcmrRegistries?.[tokenChange.category];
      if (!metadata) return false;
      if (metadata.name.toLowerCase().includes(query)) return true;
      if (metadata.token.symbol.toLowerCase().includes(query)) return true;
      return false;
    });
  }

  const searchedHistory = computed(() => {
    const query = searchQuery.value.toLowerCase().trim();
    if (!query) return selectedHistory.value;
    return selectedHistory.value?.filter(tx => txMatchesSearch(tx, query));
  });

  watch([selectedFilter, directionFilter, dateFrom, dateTo, searchQuery], () => { currentPage.value = 1 });

  const transactionCount = computed(() => searchedHistory.value?.length);

  const paginatedHistory = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage
    return searchedHistory.value?.slice(start, start + itemsPerPage)
  })
  const totalPages = computed(() => Math.ceil((searchedHistory.value?.length ?? 0) / itemsPerPage))

  // Group consecutive transactions by calendar day (history is sorted newest first)
  const groupedHistory = computed(() => {
    const groups: { label: string; transactions: TransactionHistoryItem[] }[] = [];
    for (const transaction of paginatedHistory.value ?? []) {
      const label = dayLabel(transaction.timestamp);
      let lastGroup = groups[groups.length - 1];
      if (lastGroup?.label !== label) {
        lastGroup = { label, transactions: [] };
        groups.push(lastGroup);
      }
      lastGroup.transactions.push(transaction);
    }
    return groups;
  });

  function toggleOptions() {
    showOptions.value = !showOptions.value
  }

  function toggleShowFiatValue() {
    localStorage.setItem("fiatValueHistory", showFiatValue.value ? "true" : "false");
    settingsStore.showFiatValueHistory = showFiatValue.value;
  }

  function toggleShowBalance() {
    localStorage.setItem("showBalanceInHistory", showBalance.value ? "true" : "false");
    settingsStore.showBalanceInHistory = showBalance.value;
  }

  function exportCsv() {
    const csvContent = historyToCsv(searchedHistory.value ?? [], store.bcmrRegistries, bchDisplayUnit.value, store.txNotes, tx => ({
      direction: t('history.' + txDirection(tx)),
      dapp: isDappInteraction(tx, walletHasAddress),
    }));
    const status = exportFile("cashonize-tx-history.csv", csvContent, { mimeType: "text/csv" });
    if (status !== true) $q.notify({ message: t('history.exportFailed'), icon: 'warning', color: "red" });
  }
</script>

<template>
  <div>
    <div v-if="store.walletHistory == undefined" style="text-align: center;">
      <template v-if="store.walletInitFailed">{{ t('history.loadingFailed') }}</template>
      <template v-else>{{ t('history.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>
    <div v-if="store.walletHistory?.length == 0" style="text-align: center;">{{ t('history.noTransactions') }}</div>

    <fieldset class="item" v-if="store.walletHistory?.length">
      <legend>{{ t('history.title') }}</legend>

      <div class="control-row">
        <div class="type-filter">
          <button
            v-for="option in directionOptions"
            :key="option.value"
            :class="{ active: directionFilter === option.value, 'combined-pill': option.value === 'combined' }"
            @click="directionFilter = option.value"
          >{{ t(option.label) }}</button>
        </div>
        <input ref="searchInputRef" v-model="searchQuery" type="text" :placeholder="t('history.searchPlaceholder')" class="search-input" :class="{ open: showSearch }" autocomplete="off" autocapitalize="none" spellcheck="false">
        <span class="search-toggle" :class="{ active: showSearch || searchQuery.trim() }" @click="toggleSearch">
          <q-icon name="search" size="22px" />
        </span>
        <span class="options-toggle" :class="{ active: showOptions }" :title="t('history.options')" @click="toggleOptions">
          <q-icon name="tune" size="22px" />
        </span>
      </div>

      <div v-if="showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
        <div class="option-item">
          <label for="filterTransactions">{{ t('history.filter.label') }}</label>
          <select v-model="selectedFilter" name="filterTransactions">
            <option value="allTransactions">{{ t('history.filter.all') }}</option>
            <option value="bchTransactions">{{ t('history.filter.bchTxs') }}</option>
            <option value="tokenTransactions">{{ t('history.filter.tokenTxs') }}</option>
            <option value="dappTransactions">{{ t('history.filter.dappTxs') }}</option>
          </select>
        </div>
        <div class="option-item date-range">
          <label for="dateFrom">{{ t('history.filter.dateRange') }}</label>
          <div class="date-inputs">
            <input type="date" id="dateFrom" v-model="dateFrom" :max="dateTo || undefined">
            <span>–</span>
            <input type="date" id="dateTo" v-model="dateTo" :min="dateFrom || undefined">
          </div>
        </div>
        <div class="option-item">
          {{ t('history.showFiatValue') }} <q-toggle v-model="showFiatValue" @update:model-value="toggleShowFiatValue" dense />
        </div>
        <div class="option-item">
          {{ t('history.showBalance') }} <q-toggle v-model="showBalance" @update:model-value="toggleShowBalance" dense />
        </div>
        <div class="option-item" v-if="!isCapacitor">
          <button @click="exportCsv">{{ t('history.exportCsv') }}</button>
        </div>
      </div>

      <div v-if="searchedHistory?.length === 0" style="text-align: center; padding: 20px 0;">{{ t('history.noMatch') }}</div>

      <div class="tx-list">
        <template v-for="group in groupedHistory" :key="group.transactions[0]?.hash">
          <div class="date-header">{{ group.label }}</div>
          <div
            class="tx-item"
            v-for="transaction in group.transactions"
            :key="transaction.hash"
            @click="() => selectedTransaction = transaction"
          >
            <!-- the left section and the amounts section flex equally, keeping the note centered on the card -->
            <div class="tx-left">
              <div class="tx-direction" :class="[txDirection(transaction), { pending: !transaction.timestamp }]">
                <q-icon :name="directionIcon(transaction)" size="20px" />
              </div>
              <div class="tx-info">
                <div class="tx-type">
                  {{ t('history.' + txDirection(transaction)) }}
                  <span v-if="isDappInteraction(transaction, walletHasAddress)" class="dapp-badge">{{ t('history.dapp') }}</span>
                  <span v-if="identityOperation(transaction)" class="identity-badge">{{ identityOperation(transaction) }}</span>
                  <!-- electrum reports height -1 for mempool transactions spending unconfirmed inputs -->
                  <InfoPopup v-if="transaction.blockHeight < 0" class="badge-popup" @click.stop>
                    <template #trigger>
                      <span class="warning-badge">{{ t('history.unconfirmedChain') }}</span>
                    </template>
                    {{ t('history.unconfirmedChainTooltip') }}
                  </InfoPopup>
                  <InfoPopup v-if="isBelowRelayFee(transaction)" class="badge-popup" @click.stop>
                    <template #trigger>
                      <span class="warning-badge">{{ t('history.lowFee') }}</span>
                    </template>
                    {{ t('history.lowFeeTooltip') }}
                  </InfoPopup>
                </div>
                <div class="tx-time">{{ transaction.timestamp ? formatTime(transaction.timestamp) : t('history.pending') }}</div>
              </div>
            </div>
            <div class="tx-bottom-row" v-if="confirmationsProgress(transaction) !== undefined || transaction.tokenAmountChanges.length">
              <div class="tx-confirmations-line" v-if="confirmationsProgress(transaction) !== undefined">
                {{ t('history.confirmationsProgress', { count: confirmationsProgress(transaction) }) }}
              </div>
              <div class="tx-tokens" v-if="transaction.tokenAmountChanges.length">
                <div class="token-chip" v-for="chip in tokenChangeChips(transaction, store.bcmrRegistries)" :key="chip.key">
                  <TokenIcon
                    :token-id="chip.category"
                    :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(chip.category) : undefined"
                    :size="22"
                  />
                  <span class="value" :class="{ negative: chip.negative, positive: !chip.negative }">{{ chip.amountText }}</span>
                  <span class="chip-symbol">{{ chip.symbol }}</span>
                </div>
              </div>
            </div>
            <InlineTextEdit
              class="tx-note"
              :value="store.txNotes[transaction.hash]"
              :hint="t('history.addNote')"
              :max-length="maxTxNoteLength"
              @save="(note) => store.setTxNote(transaction.hash, note)"
            />
            <div class="tx-amounts">
              <div class="tx-amount-line">
                <div class="tx-bch" :class="transaction.valueChange < 0 ? 'negative' : 'positive'">
                  {{ formatBchAmount(transaction.valueChange, true) }} {{ bchDisplayUnit }}
                </div>
                <div class="tx-fiat" v-if="settingsStore.showFiatValueHistory && store.exchangeRate !== undefined">
                  ({{ `${transaction.valueChange > 0 ? '+' : ''}` + formatFiatAmount(store.exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency) }})
                </div>
              </div>
              <div class="tx-balance" v-if="showBalance">
                {{ t('history.balanceLabel') }} {{ formatBchAmount(transaction.balance) }} {{ bchDisplayUnit }}
              </div>
            </div>
            <div class="tx-badges-line" v-if="isDappInteraction(transaction, walletHasAddress) || transaction.blockHeight < 0 || isBelowRelayFee(transaction)">
              <span v-if="isDappInteraction(transaction, walletHasAddress)" class="dapp-badge">{{ t('history.dapp') }}</span>
              <span v-if="identityOperation(transaction)" class="identity-badge">{{ identityOperation(transaction) }}</span>
              <InfoPopup v-if="transaction.blockHeight < 0" @click.stop>
                <template #trigger>
                  <span class="warning-badge">{{ t('history.unconfirmedChain') }}</span>
                </template>
                {{ t('history.unconfirmedChainTooltip') }}
              </InfoPopup>
              <InfoPopup v-if="isBelowRelayFee(transaction)" @click.stop>
                <template #trigger>
                  <span class="warning-badge">{{ t('history.lowFee') }}</span>
                </template>
                {{ t('history.lowFeeTooltip') }}
              </InfoPopup>
            </div>
          </div>
        </template>
      </div>

      <div class="tx-count">
        <span v-if="store.isHistoryPartial">{{ t('history.transactionCountPartial', { count: transactionCount?.toLocaleString("en-US") }) }}</span>
        <span v-else>{{ t('history.transactionCount', { count: transactionCount?.toLocaleString("en-US") }) }}</span>
      </div>

      <q-pagination
        v-if="totalPages > 1"
        v-model="currentPage"
        :max="totalPages"
        input
        direction-links
        boundary-numbers
        color="primary"
      />
      <div v-if="store.isHistoryPartial" class="loading-full-history">{{ t('history.loadingFullHistory') }} <q-spinner-dots size="1.2em" /></div>
    </fieldset>
  </div>

  <TransactionDialog
    v-if="selectedTransaction"
    :history-item="selectedTransaction"
    @hide="() => {selectedTransaction = undefined}">
  </TransactionDialog>
</template>

<style scoped>
.loading-full-history {
  text-align: center;
  padding: 15px 0;
}

/* fieldsets default to min-inline-size: min-content, so a long nowrap note
   would stretch the whole section (and page) beyond the viewport width */
fieldset.item {
  min-inline-size: 0;
}

.control-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin: 10px 0;
}

.options-toggle,
.search-toggle {
  cursor: pointer;
  user-select: none;
  opacity: 0.8;
}

/* icons are taller than the lowercase text, drop them slightly below the
   baseline so they read as vertically centered next to it */
.options-toggle .q-icon,
.search-toggle .q-icon {
  vertical-align: -0.2em;
}

.options-toggle.active,
.search-toggle.active {
  color: var(--color-primary);
  opacity: 1;
}

.search-input {
  width: 180px;
  padding: 4px 10px;
  margin-left: auto;
}

/* the search icon only exists in the compact layout */
.search-toggle {
  display: none;
}

/* base .type-filter pill bar styling is shared in app.css */
.type-filter {
  margin-bottom: 10px;
}

.options-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 25px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background-color: var(--color-background-soft);
  border-radius: 6px;
}

.options-panel.dark {
  background-color: #232326;
}

.option-item {
  margin-top: -5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-item select {
  width: 100px;
  padding: 2px 8px;
}

.option-item input[type="date"] {
  width: auto;
  padding: 2px 8px;
  font-size: 0.9em;
  font-family: inherit;
}

/* let the label and the date inputs wrap onto new lines on narrow screens; the inputs
   must never shrink below a full date's width or Chrome clips the value and placeholder */
.option-item.date-range {
  flex-wrap: wrap;
}

.date-inputs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}

.date-inputs input[type="date"] {
  flex: 1 1 auto;
  min-width: 125px;
}

.option-item button {
  padding: 6px 14px;
  font-size: 0.9em;
}

.date-header {
  text-transform: uppercase;
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin: 14px 2px 6px;
}

/* neutral grey alphas keep the cards theme-agnostic: no separate dark mode rules needed */
.tx-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.tx-item:hover {
  background-color: rgba(128, 128, 128, 0.14);
}

.tx-direction {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tx-direction.received {
  background-color: rgba(10, 193, 143, 0.15);
  color: var(--color-primary);
}

.tx-direction.sent {
  background-color: rgba(128, 128, 128, 0.15);
  color: var(--color-grey);
}

.tx-direction.combined {
  background-color: rgba(74, 144, 217, 0.15);
  color: #4a90d9;
}

.tx-direction.pending {
  background-color: rgba(230, 162, 60, 0.18);
  color: #e6a23c;
}

/* equal flexible side sections keep the note centered on the card */
.tx-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 0;
}

.tx-info {
  min-width: 0;
}

.tx-type {
  font-weight: 600;
  /* keep the label and its badges on one line, the note shrinks instead */
  white-space: nowrap;
}

/* transactions spending from a contract carry a small dapp tag next to the type */
.dapp-badge,
.identity-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 0.7em;
  font-weight: 600;
  vertical-align: middle;
  background-color: rgba(142, 111, 216, 0.18);
  color: #8e6fd8;
}
/* an operation on the wallet's own identity, in the primary colour rather than the dapp purple:
   this one was made here, not by somebody else's contract */
.identity-badge {
  background-color: rgba(13, 148, 136, 0.18);
  color: var(--color-primary);
}

.tx-time {
  font-size: 0.85em;
  opacity: 0.65;
}

/* shared bottom row: the confirmation progress sits left, the token chips right */
.tx-bottom-row {
  order: 5;
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* on small mobiles the badges move out of the label line to their own bottom line */
.tx-badges-line {
  display: none;
  order: 6;
  flex-basis: 100%;
  gap: 4px;
}

/* the line spaces its badges with a gap, so they drop their own left margin */
.tx-badges-line .dapp-badge,
.tx-badges-line .warning-badge {
  margin-left: 0;
}

.tx-confirmations-line {
  font-size: 0.85em;
  opacity: 0.65;
  white-space: nowrap;
}

/* transactions that carry a risk of not confirming, either because they depend on
   unconfirmed inputs or because they pay below the relay fee; each badge opens an
   info popup with the explanation */
.warning-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 0.7em;
  font-weight: 600;
  vertical-align: middle;
  background-color: rgba(230, 162, 60, 0.18);
  color: #e6a23c;
}

.tx-amounts {
  flex: 1 1 0;
  /* fixed minimum so varying amount widths don't shift the note center per row */
  min-width: 200px;
  text-align: right;
}

.tx-amount-line {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 6px;
}

.tx-bch {
  font-family: monospace;
  white-space: nowrap;
}

.tx-fiat {
  font-size: 0.85em;
  opacity: 0.75;
  white-space: nowrap;
}

.tx-balance {
  font-size: 0.8em;
  opacity: 0.6;
  white-space: nowrap;
}

.value {
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

/* the note lives between the direction info and the amounts, truncating with an
   ellipsis; clicking it edits the note inline instead of opening the dialog */
.tx-note {
  flex: 1.8 1 0;
  max-width: 360px;
  /* enlarge the click target without growing the row */
  padding: 10px 12px;
  margin: -10px 0;
}

/* rows without a note reveal the hint on hover */
.tx-item:hover :deep(.inline-edit-hint) {
  opacity: 0.55;
}

/* token changes render as wrapping chips filling the rest of the bottom row,
   so any number of tokens per transaction lays out cleanly */
.tx-tokens {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-right: 2px;
}

.token-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  background-color: rgba(128, 128, 128, 0.08);
  border-radius: 14px;
  padding: 2px 10px 2px 4px;
  font-size: 0.85em;
}

.chip-symbol {
  word-break: break-word;
}

.tx-count {
  text-align: center;
  font-size: 0.85em;
  opacity: 0.6;
  margin: 10px 0 4px;
}

/* the compact layout starts generously wide so notes get a full line of their own */
@media only screen and (max-width: 750px) {
  /* the search hides behind its icon; opened, it moves to its own full-width line */
  .search-input {
    display: none;
  }
  .search-input.open {
    display: block;
    order: 5;
    flex-basis: 100%;
    width: 100%;
    margin-left: 0;
  }
  .search-toggle {
    display: inline;
    margin-left: auto;
  }
  .type-filter button {
    padding: 4px 12px;
    font-size: 0.85em;
  }
  .tx-amount-line {
    flex-direction: column;
    align-items: flex-end;
    gap: 0;
  }
  /* dissolve the centering wrapper, the compact layout keeps the amounts in the main row */
  .tx-left {
    display: contents;
  }
  .tx-amounts {
    flex: 0 1 auto;
    margin-left: auto;
    min-width: 0;
  }
  .tx-item {
    padding: 8px 10px;
  }
  /* the note gets its own full-width line; it must stay shrinkable or its
     min-content width would stretch the fieldset past the viewport */
  .tx-note {
    flex: 0 1 100%;
    order: 4;
    max-width: none;
    font-size: 0.9em;
  }
  /* no hover on touch screens, adding notes happens in the transaction dialog */
  .tx-note.inline-edit-add {
    display: none;
  }
  /* narrow screens need the label line to wrap rather than overflow the card */
  .tx-type {
    white-space: normal;
  }
}

@media only screen and (max-width: 500px) {
  fieldset {
    padding: .5rem 1rem;
  }
  legend {
    margin-left: 0.5rem;
  }
}

@media only screen and (max-width: 450px) {
  /* combined transactions are rare and still listed under All, dropping the
     pill on small screens keeps the bar next to the icons */
  .type-filter button.combined-pill {
    display: none;
  }
}

@media only screen and (max-width: 400px) {
  /* the badges leave the crowded label line for their own line at the card bottom */
  .tx-type .dapp-badge,
  .tx-type .badge-popup {
    display: none;
  }
  .tx-badges-line {
    display: flex;
  }
}
</style>
