<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, ref } from 'vue';
  import { useWindowSize } from '@vueuse/core';
  import { ExchangeRate, type TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import EmojiItem from '../general/emojiItem.vue';
  import { formatTimestamp, formatFiatAmount } from 'src/utils/utils';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const itemsPerPage = 100
  const currentPage = ref(1)
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value <= 600)
  const hideUnit = computed(() => width.value <= 500)

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  const exchangeRate = await ExchangeRate.get(settingsStore.currency, true)

  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);
  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions");

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
</script>

<template>
  <div>
    <div v-if="store.walletHistory == undefined" style="text-align: center;">Loading transaction history ...</div>
    <div v-if="store.walletHistory?.length == 0" style="text-align: center;">No transactions in this wallet</div>

    <fieldset class="item" v-if="store.walletHistory?.length">
      <legend>Transaction History</legend>

      <div class="filter-row">
        <div style="margin-top:5px; width: 150px;  display: flex;">
          <label for="filterTransactions" style=" margin-right: 10px;">Show:</label>
          <select v-model="selectedFilter" name="filterTransactions" style="padding: 0px 4px">
            <option value="allTransactions">All</option>
            <option value="bchTransactions">BCH txs</option>
            <option value="tokenTransactions">Token txs</option>
          </select>
        </div>

        <div v-if="!isMobile">{{ transactionCount?.toLocaleString() }} Transactions </div>
      </div>

      <!-- CSS Grid table: provides fixed column widths unaffected by content like images -->
      <div class="tx-table">
        <div class="tx-header tx-row">
          <div class="tx-cell"></div>
          <div class="tx-cell">Date</div>
          <div class="tx-cell">Amount</div>
          <div class="tx-cell balance-header">Balance</div>
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

            <div class="tx-cell"><EmojiItem :emoji="transaction.timestamp ? '✅' : '⏳'" :size-px="isMobile ? 14 : 16" style="margin: 0 5px; vertical-align: sub;"/> </div>

            <div class="tx-cell" v-if="isMobile">
              <div v-if="transaction.timestamp" style="line-height: 1.3">
                <div>{{ new Date(transaction.timestamp * 1000).toLocaleDateString().replace("202", "2") }}</div>
                <div>{{new Date(transaction.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }}</div>
              </div>
              <div v-else>pending</div>
            </div>
            <div class="tx-cell" v-else>{{ transaction.timestamp ? formatTimestamp(transaction.timestamp) : "Unconfirmed" }}</div>

            <div class="tx-cell value" :style="transaction.valueChange < 0 ? 'color: rgb(188,30,30)' : ''">
              {{ `${transaction.valueChange > 0 ? '+' : '' }${(transaction.valueChange / 100_000_000).toFixed(5)}`}}
              {{ hideUnit ? "" : bchDisplayUnit }}
              <div v-if="settingsStore.showFiatValueHistory">
                ({{`${transaction.valueChange > 0 ? '+' : '' }` + formatFiatAmount(exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency)}})
              </div>
            </div>

            <div class="tx-cell value">
              {{ (transaction.balance / 100_000_000).toFixed(5) }}
              {{ hideUnit ? "" : bchDisplayUnit }}
              <div v-if="settingsStore.showFiatValueHistory">
                ~{{formatFiatAmount(exchangeRate * transaction.balance / 100_000_000, settingsStore.currency) }}
              </div>
            </div>

            <div class="tx-cell tokenChange">
              <div class="tokenChangeItem" v-for="tokenChange in transaction.tokenAmountChanges" :key="tokenChange.tokenId">
                <span v-if="tokenChange.amount !== 0n || tokenChange.nftAmount == 0n">
                  <span v-if="tokenChange.amount > 0n" class="value">+{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                  <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }}</span>
                </span>
                <span v-if="tokenChange.nftAmount !== 0n">
                  <span v-if="tokenChange.nftAmount > 0n" class="value">+{{ tokenChange.nftAmount }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ tokenChange.nftAmount }}</span>
                  <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }} NFT</span>
                </span>

                <img
                  v-if="store.bcmrRegistries?.[tokenChange.tokenId]"
                  class="tokenIcon"
                  style="width: 28px; height: 28px; border-radius: 50%;"
                  :src="store.tokenIconUrl(tokenChange.tokenId) ?? ''"
                  >
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

  <TransactionDialog v-if="selectedTransaction" :history-item="selectedTransaction" @hide="() => {selectedTransaction = undefined}"></TransactionDialog>
</template>

<style scoped>
.filter-row {
  margin-top: 5px;
  margin: auto;
  display: flex;
  align-items: baseline;
  gap: 20px;
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

.value {
  font-family: monospace;
  white-space: nowrap;
}

.tokenChange {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  text-align: end;
  gap: 4px;
}
.tokenChangeItem {
  text-align: center;
  word-break: break-word;
}

img.tokenIcon {
  margin-left: 5px;
  vertical-align: middle;
}

@media only screen and (max-width: 600px) {
  .balance-header,
  .tokens-header {
    text-align: center;
    padding-right: 0;
  }
  .tokenChange {
    align-items: center;
  }
  .tx-row {
    grid-template-columns: 28px 62px 1fr 1fr minmax(110px, 160px);
    min-width: 430px;
  }
  .tx-body {
    font-size: small;
  }
}

@media only screen and (max-width: 500px) {
  fieldset {
    padding: .5rem .5rem;
  }
  .filter-row {
    margin-left: 0.5rem;
  }
  legend {
    margin-left: 0.5rem;
  }
}
</style>