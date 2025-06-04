<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, ref } from 'vue';
  import { useWindowSize } from '@vueuse/core';
  import { ExchangeRate, type TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import { formatTimestamp, formatFiatAmount } from 'src/utils/utils';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const itemsPerPage = 100
  const currentPage = ref(1)
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 570)

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  const exchangeRate = +(await ExchangeRate.get(settingsStore.currency, true)).toFixed(2)

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

      <div style="margin-top:5px; margin: auto; display: flex; align-items: baseline; gap: 20px;">
        <div style="margin-top:5px; width: 150px;  display: flex;">
          <label for="filterTransactions" style=" margin-right: 10px;">Show:</label>
          <select v-model="selectedFilter" name="filterTransactions" style="padding: 0px 4px">
            <option value="allTransactions">All</option>
            <option value="bchTransactions">BCH txs</option>
            <option value="tokenTransactions">Token txs</option>
          </select>
        </div>

        <div v-if="!isMobile">{{ transactionCount }} Transactions </div>
      </div>

      <table>
        <thead>
          <tr style="padding-left: 10px;">
            <th scope="col"></th>
            <th scope="col">Date</th>
            <th scope="col" class="valueHeader">Amount</th>
            <th scope="col" class="valueHeader">Balance</th>
            <th scope="col" style="text-align: right; padding-right: 40px;">Tokens</th>
          </tr>
        </thead>
        <tbody class="transactionTable">
          <tr
            v-for="transaction in paginatedHistory"
            :key="transaction.hash"
            @click="() => selectedTransaction = transaction"
            :class="settingsStore.darkMode ? 'dark' : ''"
          >

            <td>{{ transaction.timestamp ? "✅" : "⏳" }}</td>

            <td v-if="isMobile">
              <div v-if="transaction.timestamp" style="line-height: 1.3">
                <div>{{ new Date(transaction.timestamp * 1000).toLocaleDateString().replace("202", "2") }}</div>
                <div>{{new Date(transaction.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }}</div>
              </div>
              <div v-else>pending</div>
            </td>
            <td v-else>{{ transaction.timestamp ? formatTimestamp(transaction.timestamp) : "Unconfirmed" }}</td>

            <td class="value" :style="transaction.valueChange < 0 ? 'color: rgb(188,30,30)' : ''">
              {{ `${transaction.valueChange > 0 ? '+' : '' }${(transaction.valueChange / 100_000_000).toFixed(5)}`}}
              {{ isMobile? "" : (bchDisplayUnit) }}
              <div v-if="settingsStore.showFiatValueHistory">
                ({{`${transaction.valueChange > 0 ? '+' : '' }` + formatFiatAmount(exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency)}})
              </div>
            </td>
              
            <td class="value">
              {{ (transaction.balance / 100_000_000).toFixed(5) }}
              {{ isMobile? "" : (bchDisplayUnit) }}
              <div v-if="settingsStore.showFiatValueHistory">
                ~{{formatFiatAmount(exchangeRate * transaction.balance / 100_000_000, settingsStore.currency) }}
              </div>
            </td>

            <td class="tokenChange">
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
                  style="width: 24px; height: 24px; border-radius: 50%;"
                  :src="store.tokenIconUrl(tokenChange.tokenId) ?? ''"
                  >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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
tr:nth-child(even) {
  background-color: var(--color-background-soft);
}
tr.dark:nth-child(even) {
  background-color: #232326;
}

.transactionTable > * {
  font-size: smaller;
}

.value {
  font-family: monospace;
}

.tokenChange {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  text-align: end;
  width: auto;
  margin-left: -30px;
}
.tokenChangeItem {
  max-width: 160px;
  overflow: auto;
  display: flex;
  align-items: center;
}

img.tokenIcon {
  margin-left: 5px;
}

.break {
  word-break: keep-all;
  text-align: end;
}

@media only screen and (max-width: 570px) {
  fieldset {
    padding: .5rem 1rem;
  }
  .tokenIcon {
    margin-right: 0px;
  }
  .tokenChange{
    margin-left: 0px;
  }
  .tokenChangeItem {
    max-width: 120px;
    text-align: center;
    width: 100%;
    flex-direction: column;
    justify-content: center;
  }
  .transactionTable > * {
    font-size: small;
  }
}
</style>

<style>
.q-pagination .q-btn {
  background-color: transparent !important;
}
.q-pagination .q-field {
  width: 5em !important;
  margin: 10px 0px;
}
.q-pagination .q-field__inner {
  width: 100%;
}
.q-pagination .q-field__control-container {
  width: 100%;
}
.q-pagination .q-field__native {
  color: var(--font-color);
}
</style>