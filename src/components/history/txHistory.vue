<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, ref, watch, nextTick, onActivated, onDeactivated } from 'vue';
  import { useWindowSize } from 'src/utils/composables';
  import type { TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import { formatTime, formatFiatAmount, formatBchAmount, tokenChangeChips } from 'src/utils/utils';
  import { historyToCsv } from 'src/utils/csvUtils';
  import { maxTxNoteLength } from 'src/utils/txNotes';
  import TokenIcon from '../general/TokenIcon.vue';
  import { useI18n } from 'vue-i18n'
  import { exportFile, useQuasar } from 'quasar'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const $q = useQuasar()
  const isCapacitor = import.meta.env.QUASAR_CAPACITOR_MODE;
  const itemsPerPage = 100

  // state options menu
  const showOptions = ref(false)
  const showFiatValue = ref(settingsStore.showFiatValueHistory)
  const hideBalance = ref(settingsStore.hideBalanceColumn)
  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions");
  const directionFilter = ref("all" as "all" | "incoming" | "outgoing");
  const dateFrom = ref("");
  const dateTo = ref("");
  const searchQuery = ref("");
  const searchInputRef = ref<HTMLInputElement | null>(null);
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value <= 600);
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
  ] as const;

  const currentPage = ref(1)
  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);

  // Inline note editing in the transaction rows; only one row edits at a time
  const editingNoteTx = ref(null as string | null);
  const noteDraft = ref("");
  const noteInputRef = ref<HTMLInputElement | null>(null);

  // Template refs inside v-for are collected into arrays, so a function ref is
  // needed to capture the single active edit input as a plain element
  function setNoteInputRef(el: unknown) {
    noteInputRef.value = el as HTMLInputElement | null;
  }

  async function startNoteEdit(txHash: string) {
    editingNoteTx.value = txHash;
    noteDraft.value = store.txNotes[txHash] ?? "";
    // the input is behind a v-if, wait for the DOM update before focusing it
    await nextTick();
    noteInputRef.value?.focus();
  }

  function saveNoteEdit() {
    if (editingNoteTx.value === null) return;
    store.setTxNote(editingNoteTx.value, noteDraft.value);
    editingNoteTx.value = null;
  }

  function cancelNoteEdit() {
    editingNoteTx.value = null;
  }

  // Blur alone can't close the editor: pressing Quasar controls (pagination, toggles)
  // prevents default on mousedown, so the input never blurs. Watch presses at the
  // document level while editing and close on any press outside the edit field.
  function handleGlobalMousedown(event: MouseEvent) {
    const editingContainer = noteInputRef.value?.parentElement;
    if (!editingContainer || !editingContainer.contains(event.target as Node)) saveNoteEdit();
  }

  watch(editingNoteTx, (editing, _prev, onCleanup) => {
    if (editing === null) return;
    document.addEventListener('mousedown', handleGlobalMousedown, true);
    onCleanup(() => document.removeEventListener('mousedown', handleGlobalMousedown, true));
  });

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
  onDeactivated(() => {
    document.removeEventListener('keydown', handleCtrlF);
    // close an open note editor when navigating away from the history view
    saveNoteEdit();
  });

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  // Date inputs hold local calendar dates (YYYY-MM-DD); compare in local time to match the displayed dates
  function localDayStart(isoDate: string, dayOffset = 0): number {
    const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day + dayOffset).getTime() / 1000;
  }

  const selectedHistory = computed(() => {
    let history = store.walletHistory;
    if (selectedFilter.value === "bchTransactions") history = history?.filter(tx => !tx.tokenAmountChanges.length);
    if (selectedFilter.value === "tokenTransactions") history = history?.filter(tx => tx.tokenAmountChanges.length);
    if (directionFilter.value === "incoming") history = history?.filter(tx => isIncoming(tx));
    if (directionFilter.value === "outgoing") history = history?.filter(tx => !isIncoming(tx));
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

  // Group consecutive transactions by calendar day (history is sorted newest first).
  // Pending transactions have no timestamp and group under their own header.
  function dayLabel(timestamp: number | undefined): string {
    if (!timestamp) return t('history.pending');
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t('history.today');
    if (date.toDateString() === yesterday.toDateString()) return t('history.yesterday');
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

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

  // Direction is derived from the net BCH change: receiving (BCH or tokens) always adds
  // value, while a wallet-authored transaction always pays the fee so its net is negative
  function isIncoming(transaction: TransactionHistoryItem): boolean {
    return transaction.valueChange >= 0;
  }

  function toggleOptions() {
    showOptions.value = !showOptions.value
  }

  function toggleShowFiatValue() {
    localStorage.setItem("fiatValueHistory", showFiatValue.value ? "true" : "false");
    settingsStore.showFiatValueHistory = showFiatValue.value;
  }

  function toggleHideBalance() {
    localStorage.setItem("hideBalanceColumn", hideBalance.value ? "true" : "false");
    settingsStore.hideBalanceColumn = hideBalance.value;
  }

  function exportCsv() {
    const csvContent = historyToCsv(searchedHistory.value ?? [], store.bcmrRegistries, bchDisplayUnit.value, store.txNotes);
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
            :class="{ active: directionFilter === option.value }"
            @click="directionFilter = option.value"
          >{{ t(option.label) }}</button>
        </div>
        <input v-if="!isMobile || showSearch" ref="searchInputRef" v-model="searchQuery" type="text" :placeholder="t('history.searchPlaceholder')" class="search-input" autocomplete="off" autocapitalize="none" spellcheck="false">
        <span v-if="isMobile" class="search-toggle" :class="{ active: showSearch || searchQuery.trim() }" @click="toggleSearch">
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
          {{ t('history.hideBalanceColumn') }} <q-toggle v-model="hideBalance" @update:model-value="toggleHideBalance" dense />
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
            <div class="tx-direction" :class="[isIncoming(transaction) ? 'received' : 'sent', { pending: !transaction.timestamp }]">
              <q-icon :name="isIncoming(transaction) ? 'arrow_downward' : 'arrow_upward'" size="20px" />
            </div>
            <div class="tx-info">
              <div class="tx-type">{{ isIncoming(transaction) ? t('history.received') : t('history.sent') }}</div>
              <div class="tx-time">{{ transaction.timestamp ? formatTime(transaction.timestamp) : t('history.pending') }}</div>
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
            <div class="tx-note" v-if="editingNoteTx === transaction.hash" @click.stop>
              <input
                :ref="setNoteInputRef"
                v-model="noteDraft"
                class="note-input"
                type="text"
                :maxlength="maxTxNoteLength"
                autocomplete="off"
                spellcheck="false"
                @blur="saveNoteEdit"
                @keyup.enter="saveNoteEdit"
                @keyup.esc="cancelNoteEdit"
              >
            </div>
            <div
              class="tx-note"
              v-else-if="store.txNotes[transaction.hash]"
              :title="store.txNotes[transaction.hash]"
              @click.stop="startNoteEdit(transaction.hash)"
            >{{ store.txNotes[transaction.hash] }}</div>
            <div class="tx-note tx-note-add" v-else @click.stop="startNoteEdit(transaction.hash)">
              <span class="add-note-hint">{{ t('history.addNote') }} <q-icon name="edit" size="14px" /></span>
            </div>
            <div class="tx-amounts">
              <div class="tx-amount-line">
                <div class="tx-bch" :class="transaction.valueChange < 0 ? 'negative' : 'positive'">
                  {{ formatBchAmount(transaction.valueChange, true) }} {{ bchDisplayUnit }}
                </div>
                <div class="tx-fiat" v-if="settingsStore.showFiatValueHistory && store.exchangeRate !== undefined">
                  ({{ `${transaction.valueChange > 0 ? '+' : ''}` + formatFiatAmount(store.exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency) }})
                </div>
              </div>
              <div class="tx-balance" v-if="!hideBalance">
                {{ t('history.balanceLabel') }} {{ formatBchAmount(transaction.balance) }} {{ bchDisplayUnit }}
              </div>
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

/* segmented pill bar for the transaction direction filter */
.type-filter {
  display: inline-flex;
  background-color: rgba(128, 128, 128, 0.12);
  border-radius: 20px;
  padding: 3px;
  margin-bottom: 10px;
}

.type-filter button {
  border: none;
  margin: 0;
  background: transparent;
  color: inherit;
  border-radius: 17px;
  padding: 4px 16px;
  font-size: 0.9em;
  cursor: pointer;
}

.type-filter button.active {
  background-color: var(--color-primary);
  color: white;
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

.tx-direction.pending {
  background-color: rgba(230, 162, 60, 0.18);
  color: #e6a23c;
}

.tx-info {
  min-width: 0;
}

.tx-type {
  font-weight: 600;
}

.tx-time {
  font-size: 0.85em;
  opacity: 0.65;
}

.tx-amounts {
  margin-left: auto;
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

/* the note sits front and center between the direction info and the amounts,
   filling the free space and truncating with an ellipsis when it runs out;
   clicking it edits the note inline instead of opening the transaction dialog */
.tx-note {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  /* enlarge the click target without growing the row; the horizontal padding
     keeps the note and its edit input clear of the neighboring text */
  padding: 10px 12px;
  margin: -10px 0;
}

/* rows without a note reveal the hint on hover */
.add-note-hint {
  opacity: 0;
  transition: opacity 0.2s;
}

.tx-item:hover .add-note-hint {
  opacity: 0.55;
}

.add-note-hint .q-icon {
  vertical-align: -0.15em;
}

/* the focused state needs the same overrides: the global chota input rules
   outweigh a single class and would bring back the border and focus ring */
.tx-note .note-input,
.tx-note .note-input:focus {
  width: 100%;
  text-align: center;
  font-size: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  box-shadow: none;
  border-bottom: 1px solid var(--color-primary);
  border-radius: 0;
  padding: 0 4px 1px;
  margin: 0;
}

/* token changes render as wrapping chips on their own line below the main row, so any
   number of tokens per transaction lays out cleanly; order moves them after the amounts,
   which sit in the main row despite coming later in the DOM */
.tx-tokens {
  order: 5;
  flex-basis: 100%;
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

@media only screen and (max-width: 600px) {
  /* search moves to its own full-width line, the options toggle stays beside the pills */
  .search-input {
    order: 5;
    flex-basis: 100%;
    width: 100%;
    margin-left: 0;
  }
  .search-toggle {
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
  .tx-item {
    padding: 8px 10px;
  }
  /* not enough room in the main row on mobile, the note gets its own
     full-width line below it (before the token chips at order 5) */
  .tx-note {
    flex: none;
    order: 4;
    flex-basis: 100%;
    font-size: 0.9em;
  }
  /* no hover on touch screens, adding notes happens in the transaction dialog */
  .tx-note-add {
    display: none;
  }
}

@media only screen and (max-width: 500px) {
  fieldset {
    padding: .5rem .5rem;
  }
  legend {
    margin-left: 0.5rem;
  }
}
</style>
