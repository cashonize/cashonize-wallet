<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, onMounted, ref, watch } from 'vue';
  import { useWindowSize } from '@vueuse/core';
  import { ExchangeRate, type TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import EmojiItem from '../general/emojiItem.vue';
  import { formatTimestamp, formatTime, formatFiatAmount } from 'src/utils/utils';
  import Toggle from '@vueform/toggle'
  import TokenIcon from '../general/TokenIcon.vue';

  const store = useStore()
  const settingsStore = useSettingsStore()
  const itemsPerPage = 100
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value <= 600)
  const hideUnit = computed(() => width.value <= 500)

  // state options menu
  const showOptions = ref(false)
  const showFiatValue = ref(settingsStore.showFiatValueHistory)
  const hideBalance = ref(settingsStore.hideBalanceColumn)
  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions");

  const currentPage = ref(1)
  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);
  const exchangeRate = ref<number | undefined>(undefined);
    
  onMounted(async () => {
    exchangeRate.value = await ExchangeRate.get(settingsStore.currency, true);
  });

  // Auto-hide balance column on small screens
  watch(() => width.value <= 450, (isSmallScreen) => {
    if (isSmallScreen) hideBalance.value = true
  }, { immediate: true })

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  const selectedHistory = computed(() => {
    if (selectedFilter.value === "bchTransactions") return store.walletHistory?.filter(tx => !tx.tokenAmountChanges.length);
    if (selectedFilter.value === "tokenTransactions") return store.walletHistory?.filter(tx => tx.tokenAmountChanges.length);
    return store.walletHistory;
  });

  const transactionCount = computed(() => selectedHistory.value?.length);

  const paginatedHistory = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage
    return selectedHistory.value?.slice(start, start + itemsPerPage)
  })
  const totalPages = computed(() => Math.ceil((selectedHistory.value?.length ?? 0) / itemsPerPage))

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
</script>

<template>
  <div>
    <div v-if="store.walletHistory == undefined" style="text-align: center;">Loading transaction history ...</div>
    <div v-if="store.walletHistory?.length == 0" style="text-align: center;">No transactions in this wallet</div>

    <fieldset class="item" v-if="store.walletHistory?.length">
      <legend>Transaction History</legend>

      <div class="filter-row">
        <div>{{ transactionCount?.toLocaleString("en-US") }} Transactions</div>
        <span class="options-toggle" @click="toggleOptions">
          Options
          <img
            class="icon"
            :class="{ 'expanded': showOptions }"
            :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'"
          >
        </span>
      </div>

      <div v-if="showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
        <div class="option-item">
          <label for="filterTransactions">Show:</label>
          <select v-model="selectedFilter" name="filterTransactions">
            <option value="allTransactions">All</option>
            <option value="bchTransactions">BCH txs</option>
            <option value="tokenTransactions">Token txs</option>
          </select>
        </div>
        <div class="option-item">
          Show fiat value <Toggle v-model="showFiatValue" @change="toggleShowFiatValue"/>
        </div>
        <div class="option-item">
          Hide balance column <Toggle v-model="hideBalance" @change="toggleHideBalance"/>
        </div>
      </div>

      <!-- CSS Grid table: provides fixed column widths unaffected by content like images -->
      <div class="tx-table" :class="{ 'hide-balance': hideBalance }">
        <div class="tx-header tx-row">
          <div class="tx-cell"></div>
          <div class="tx-cell">Date</div>
          <div class="tx-cell">Amount</div>
          <div class="tx-cell balance-header" v-if="!hideBalance">Balance</div>
          <div class="tx-cell tokens-header">Tokens</div>
        </div>
        <div class="tx-body">
          <div
            class="tx-row"
            v-for="(transaction, index) in paginatedHistory"
            :key="transaction.hash"
            @click="() => selectedTransaction = transaction"
            :class="[settingsStore.darkMode ? 'dark' : '', index % 2 === 1 ? 'even' : '']"
          >

            <div class="tx-cell status-cell"><EmojiItem :emoji="transaction.timestamp ? '✅' : '⏳'" :size-px="isMobile ? 14 : 16" style="vertical-align: sub;"/> </div>

            <div class="tx-cell" v-if="isMobile">
              <div v-if="transaction.timestamp" style="line-height: 1.3">
                <div>{{ formatTimestamp(transaction.timestamp, settingsStore.dateFormat, true) }}</div>
                <div>{{ formatTime(transaction.timestamp) }}</div>
              </div>
              <div v-else>pending</div>
            </div>
            <div class="tx-cell" v-else>{{ formatTimestamp(transaction.timestamp, settingsStore.dateFormat) }}</div>

            <div class="tx-cell value" :class="{ 'negative': transaction.valueChange < 0 }">
              {{ `${transaction.valueChange > 0 ? '+' : '' }${(transaction.valueChange / 100_000_000).toLocaleString("en-US", {minimumFractionDigits: 5, maximumFractionDigits: 5})}`}}
              {{ hideUnit ? "" : bchDisplayUnit }}
              <div v-if="settingsStore.showFiatValueHistory && exchangeRate !== undefined">
                ({{`${transaction.valueChange > 0 ? '+' : '' }` + formatFiatAmount(exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency)}})
              </div>
            </div>

            <div class="tx-cell value" v-if="!hideBalance">
              {{ (transaction.balance / 100_000_000).toLocaleString("en-US", {minimumFractionDigits: 5, maximumFractionDigits: 5}) }}
              {{ hideUnit ? "" : bchDisplayUnit }}
              <div v-if="settingsStore.showFiatValueHistory && exchangeRate !== undefined">
                ~{{formatFiatAmount(exchangeRate * transaction.balance / 100_000_000, settingsStore.currency) }}
              </div>
            </div>

            <div class="tx-cell tokenChange">
               <!-- Tokens like BADGER have both fungibles and NFTs with the same tokenId in user wallets -->
              <div class="tokenChangeItem" v-for="tokenChange in transaction.tokenAmountChanges" :key="tokenChange.tokenId">
                <span v-if="tokenChange.amount !== 0n || tokenChange.nftAmount == 0n">
                  <span v-if="tokenChange.amount > 0n" class="value">+{{
                    (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}
                  </span>
                  <span v-else class="value negative">
                    {{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}
                  </span>
                  <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }}</span>
                  <TokenIcon
                    v-if="tokenChange.amount"
                    class="historyTokenIcon"
                    :token-id="tokenChange.tokenId"
                    :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(tokenChange.tokenId) : undefined"
                    :size="28"
                  />
                </span>
                <span v-if="tokenChange.nftAmount" class="nftChange">
                  <span v-if="tokenChange.nftAmount > 0n" class="value">+{{ tokenChange.nftAmount }}</span>
                  <span v-else class="value negative">{{ tokenChange.nftAmount }}</span>
                  <span>
                    {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }} NFT
                  </span>
                  <TokenIcon
                    v-if="tokenChange.nftAmount"
                    class="historyTokenIcon"
                    :token-id="tokenChange.tokenId"
                    :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(tokenChange.tokenId) : undefined"
                    :size="28"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>
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
    </fieldset>
  </div>

  <TransactionDialog
    v-if="selectedTransaction"
    :history-item="selectedTransaction"
    @hide="() => {selectedTransaction = undefined}">
  </TransactionDialog>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 10px 0;
}

.options-toggle {
  cursor: pointer;
  user-select: none;
}

.expanded {
  transform: rotate(180deg);
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

.tx-table {
  width: 100%;
  overflow-x: auto;
}

.tx-row {
  display: grid;
  grid-template-columns: 45px 1fr 1fr 1fr minmax(120px, 220px);
  min-width: 550px;
  align-items: center;
  cursor: pointer;
}

.hide-balance .tx-row {
  grid-template-columns: 45px 1fr minmax(100px, 150px) minmax(150px, 1fr);
  min-width: 400px;
}

.hide-balance .tx-cell.value,
.hide-balance .tx-header .tx-cell:nth-child(3) {
  text-align: center;
}

.tx-header {
  font-weight: bold;
  cursor: default;
  border-bottom: 1px solid var(--color-border);
}

.tx-cell.tokens-header {
  text-align: right;
  padding-right: 40px;
}

.tx-body .tx-row.even {
  background-color: var(--color-background-soft);
}
.tx-body .tx-row.dark.even {
  background-color: #232326;
}

.tx-body {
  font-size: smaller;
}

.tx-body .tx-row {
  min-height: 67px;
}

.tx-cell {
  padding: 12px 2px;
  min-width: 0;
}

.tx-cell.status-cell {
  padding-left: 6px;
}

.value {
  font-family: monospace;
  white-space: nowrap;
}
.negative {
  color: rgb(188, 30, 30);
}
body.dark .negative {
  color: #ef9a9a;
}

.tokenChange {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  text-align: end;
  gap: 4px;
  padding-right: 6px;
}
.tokenChangeItem {
  text-align: center;
  word-break: break-word;
}
.nftChange {
  display: block;
}

.historyTokenIcon {
  margin-left: 5px;
  vertical-align: middle;
}

@media only screen and (max-width: 600px) {
  .tokens-header {
    text-align: center;
    padding-right: 0;
  }
  .tokenChange {
    align-items: center;
  }
  .tx-row {
    grid-template-columns: 30px 66px 1fr 1fr minmax(110px, 160px);
    min-width: 330px;
  }
  .hide-balance .tx-row {
    grid-template-columns: 30px 66px 1fr 1fr;
    min-width: 260px;
  }
  .tx-body {
    font-size: small;
  }
  .historyTokenIcon {
    display: block;
    width: fit-content;
    margin: 4px auto 0;
  }
}

@media only screen and (max-width: 500px) {
  fieldset {
    padding: .5rem .5rem;
  }
  .tx-row {
    grid-template-columns: 28px 62px minmax(70px, 1fr) minmax(70px, 1fr) minmax(100px, 120px);
  }
  .hide-balance .tx-row {
    grid-template-columns: 28px 62px 1fr 1fr;
  }
  .filter-row {
    margin-left: 0.5rem;
  }
  legend {
    margin-left: 0.5rem;
  }
}

@media only screen and (max-width: 400px) {
  .tx-row {
    grid-template-columns: 24px 62px minmax(70px, 1fr) minmax(70px, 1fr) minmax(100px, 120px);
  }
  .hide-balance .tx-row {
    grid-template-columns: 24px 62px 1fr 1fr;
  }
}
</style>