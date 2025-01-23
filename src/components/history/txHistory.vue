<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, ref } from 'vue';
  import { useWindowSize } from '@vueuse/core';
  import { ExchangeRate } from 'mainnet-js';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 570)

  const exchangeRate = +(await ExchangeRate.get(settingsStore.currency, true)).toFixed(2)

  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions");

  const selectedHistory = computed(() => {
    if (selectedFilter.value === "bchTransactions") return store.walletHistory?.filter(tx => !tx.tokenAmountChanges.length);
    if (selectedFilter.value === "tokenTransactions") return store.walletHistory?.filter(tx => tx.tokenAmountChanges.length);
    return store.walletHistory;
  });

  const transactionCount = computed(() => selectedHistory.value?.length);

  function formatTimestamp(timestamp?: number){
    if (!timestamp) return "Unconfirmed";
    const date = new Date(timestamp * 1000);
    const hoursAndMinutes = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString() + ' ' + hoursAndMinutes
  }

  function tokenIconUrl(tokenId: string) {
    if (tokenId === "BCH") {
      return 'images/bch-icon.png';
    }

    const tokenIconUri = store.bcmrRegistries?.[tokenId]?.uris?.icon;
    if (!tokenIconUri) {
      return undefined;
    }

    if (tokenIconUri.startsWith('ipfs://')) {
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    } else {
      return tokenIconUri;
    }
  }
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
            <th v-if="!isMobile" scope="col"></th>
            <th scope="col">Date</th>
            <th scope="col" class="valueHeader">Amount</th>
            <th scope="col" class="valueHeader">Balance</th>
            <th scope="col" style="text-align: right; padding-right: 40px;">Tokens</th>
          </tr>
        </thead>
        <tbody class="transactionTable">
          <tr :class="settingsStore.darkMode ? 'dark' : ''" v-for="transaction in selectedHistory" :key="transaction.hash">

            <td v-if="!isMobile">{{ transaction.timestamp ? "✅" : "⏳" }}</td>

            <td v-if="isMobile">
              <div style="line-height: 1">{{ new Date(transaction.timestamp * 1000).toLocaleDateString().replace("202", "2") }}</div>
              <div>{{ new Date(transaction.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }}</div>
            </td>
            <td v-else>{{ transaction.timestamp ? formatTimestamp(transaction.timestamp) : "Unconfirmed" }}</td>

            <td class="value" :style="transaction.valueChange < 0 ? 'color: rgb(188,30,30)' : ''">
              {{ `${transaction.valueChange > 0 ? '+' : '' }${transaction.valueChange / 100_000_000}` + (isMobile? "" : " BCH")}}
              <div v-if="settingsStore.showFiatValueHistory">({{`${transaction.valueChange > 0 ? '+' : '' }` + (exchangeRate * transaction.valueChange / 100_000_000).toFixed(2)}}$)</div>
            </td>
              
            <td class="value">
              {{ transaction.balance / 100_000_000 }}{{ isMobile? "" : " BCH" }}
              <div v-if="settingsStore.showFiatValueHistory">~{{(exchangeRate * transaction.balance / 100_000_000).toFixed(2)}}$</div>
            </td>

            <td v-if="transaction.tokenAmountChanges.length" class="tokenChange">
              <div style="max-width: 160px; display: flex; align-items: center;" v-for="tokenChange in transaction.tokenAmountChanges" :key="tokenChange.tokenId">
                <span v-if="tokenChange.amount !== 0n || tokenChange.nftAmount == 0n">
                  <div style="display: flex; flex-direction: column;">
                   <div>
                      <span v-if="tokenChange.amount > 0n" class="value">+{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                      <span v-else class="value" style="color: rgb(188,30,30)">{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                      <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }}</span>
                    </div>
                    <div style="display: flex; justify-content: end;" :style="tokenChange.amount < 0n ? 'color: rgb(188,30,30)' : ''">
                    </div>
                  </div>
                </span>
                <span v-if="tokenChange.nftAmount !== 0n">
                  <span v-if="tokenChange.nftAmount > 0n" class="value">+{{ tokenChange.nftAmount }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ tokenChange.nftAmount }}</span>
                  <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }} NFT</span>
                </span>

                <img v-if="store.bcmrRegistries?.[tokenChange.tokenId]" class="tokenIcon" style="width: 24px; height: 24px; border-radius: 50%;" :src="tokenIconUrl(tokenChange.tokenId)">
              </div>
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>
    </fieldset>
  </div>
</template>

<style lang="css">
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
  align-items: end;
  justify-content: flex-end;
  text-align: end;
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
  .tokenChange {
    flex-direction: column;
  }
}
</style>