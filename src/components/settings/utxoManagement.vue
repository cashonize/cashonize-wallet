<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { copyToClipboard, formatFiatAmount, getFungibleTokenBalances, getTokenUtxos, satsToBch } from 'src/utils/utils';
  import { ExchangeRate, TokenSendRequest, type UtxoI } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const activeAction = ref<'consolidating' | 'splitting' | null>(null);

  const exchangeRate = await ExchangeRate.get(settingsStore.currency, true)

  const totalUtxos = computed(() => store.walletUtxos?.length ?? 0);
  const bchOnlyUtxos = computed(() => store.walletUtxos?.filter(utxo => !utxo.token)?.length ?? 0);
  const tokenUtxos = computed(() => getTokenUtxos(store.walletUtxos as UtxoI[]).length);
  // TODO: consider lowering this to 1000 satoshis in the future
  // note: the bliss airdrop tool uses 2000 sats so from that point, many users would have combined UTXOs
  const utxosWithBchAndTokens = computed(() => {
    return store.walletUtxos!.filter(utxo => utxo.token?.tokenId && utxo.satoshis > 5_000n);
  });

  const hasProblematicUtxos = computed(() => utxosWithBchAndTokens.value?.length > 0);
  const hasNftUtxos = computed(() => utxosWithBchAndTokens.value.filter(utxo => utxo.token?.capability).length > 0);

  const satsToSplit = computed(() => {
    return utxosWithBchAndTokens.value.reduce((sum:bigint, utxo) => sum + BigInt(utxo.satoshis) - 1000n, 0n)
  })

  function truncateHash(hash: string) {
    return hash.slice(0, 10) + '...' + hash.slice(-6);
  }

  async function consolidateBchUtxos() {
    if (activeAction.value) return;
    activeAction.value = 'consolidating';
    try{
      $q.notify({
        spinner: true,
        message: 'Consolidating BCH UTXOs...',
        color: 'grey-5',
        timeout: 1000
      })
      await store.wallet.sendMax(store.wallet.cashaddr)
      $q.notify({
        type: 'positive',
        message: 'Consolidated BCH UTXOs successfully!'
      })
      // update wallet state
      await store.updateWalletUtxos()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    } finally {
      activeAction.value = null;
    }
  }

  async function splitBchFromTokenUtxos() {
    if (activeAction.value) return;
    if(!utxosWithBchAndTokens.value || !store.walletUtxos) return
    activeAction.value = 'splitting';
    try{
      const tokenUtxos = getTokenUtxos(store.walletUtxos);
      const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
      const uniqueTokenIdsToSplit: Set<string> = new Set()
      utxosWithBchAndTokens.value.forEach(utxo => {
        if(utxo.token?.amount && !utxo.token?.capability) {
          uniqueTokenIdsToSplit.add(utxo.token.tokenId)
        }
      })
      $q.notify({
        spinner: true,
        message: 'Splitting BCH from Token UTXOs...',
        color: 'grey-5',
        timeout: 1000 * uniqueTokenIdsToSplit.size
      })
      // splitBchFromTokenUtxos esentially sends all fungible tokens
      for(const uniqueTokenIdToSplit of uniqueTokenIdsToSplit) {
        const { txId } = await store.wallet.send([
          new TokenSendRequest({
            cashaddr: store.wallet.tokenaddr,
            amount: fungibleTokensResult[uniqueTokenIdToSplit] as bigint,
            tokenId: uniqueTokenIdToSplit,
          }),
        ]);
        console.log(`Split BCH from Token UTXO ${uniqueTokenIdToSplit} with txid: ${txId}`);
      }
      $q.notify({
        type: 'positive',
        message: 'Split BCH from Token UTXO successfully!'
      })
      // update wallet state once at the end
      await store.updateWalletUtxos()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    } finally {
      activeAction.value = null;
    }
  }
</script>

<template>
  <fieldset class="item" :class="{ dark: settingsStore.darkMode }">
    <legend>UTXO Management</legend>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-value">{{ totalUtxos }}</span>Total UTXOs
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ bchOnlyUtxos }}</span>BCH-only UTXOs
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ tokenUtxos }}</span>Token UTXOs
      </div>
    </div>

    <!-- Consolidate BCH Section -->
    <div class="section">
      <div><strong>Consolidate BCH UTXOs</strong></div>
      <div class="description">
        Combine all BCH-only UTXOs into a single UTXO. If a dApp asks you to "consolidate your funds" even though you have enough balance, it means you have too many small UTXOs.
      </div>
      <input
        @click="consolidateBchUtxos()"
        type="button"
        class="primaryButton"
        :value="activeAction === 'consolidating' ? 'Consolidating...' : 'Consolidate BCH'"
        :disabled="activeAction !== null || bchOnlyUtxos <= 1"
      >
      <div v-if="bchOnlyUtxos <= 1" class="hint">
        Your wallet already has {{ bchOnlyUtxos === 0 ? 'no' : 'only 1' }} BCH-only UTXO.
      </div>
    </div>

    <!-- UTXO Status Section -->
    <div class="utxo-status-section">
      <!-- Combined BCH + Token UTXOs -->
      <div v-if="hasProblematicUtxos">
        <div class="status-line text-warning">
          <span class="status-icon">!</span>
          <span>{{ utxosWithBchAndTokens.length }} UTXO{{ utxosWithBchAndTokens.length > 1 ? 's' : '' }} with combined BCH + Tokens</span>
        </div>
        <div class="description">
          Some dApps return UTXOs that combine BCH with tokens, causing the BCH to not show in your balance.
          You have <strong>{{ satsToBch(satsToSplit) }} BCH</strong>
          ({{ formatFiatAmount(exchangeRate * satsToBch(satsToSplit), settingsStore.currency) }})
          that can be split from token UTXOs.
        </div>

        <div v-if="hasNftUtxos" class="description" style="font-style: italic;">
          Note: This tool can only split BCH from fungible token UTXOs, not NFTs.
        </div>

        <!-- Affected UTXOs List -->
        <details class="utxo-details">
          <summary>
            View affected UTXOs
            <img
              class="chevron-icon"
              :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'"
            >
          </summary>
          <table class="utxo-table">
            <thead>
              <tr>
                <th>#</th>
                <th>BCH</th>
                <th>Token</th>
                <th>Type</th>
                <th>TxId</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(utxo, index) in utxosWithBchAndTokens" :key="index">
                <td>{{ index + 1 }}</td>
                <td class="mono">
                  {{ satsToBch(utxo.satoshis) }}
                  <span v-if="utxo.satoshis > 100_000n" style="color: orange;">&#9888;</span>
                </td>
                <td>{{ store.bcmrRegistries?.[utxo.token!.tokenId]?.name || truncateHash(utxo.token!.tokenId) }}</td>
                <td>{{ utxo.token?.amount && utxo.token.capability ? 'FT+NFT' : (utxo.token?.amount ? 'FT' : 'NFT') }}</td>
                <td>
                  <span @click="copyToClipboard(utxo.txid)" style="cursor: pointer;">
                    <span class="txid-full mono" style="color: var(--color-grey);">{{ truncateHash(utxo.txid) }}</span>
                    <span class="txid-mobile" style="color: var(--color-grey);">copy</span>
                    <img class="copyIcon" src="images/copyGrey.svg">
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </details>

        <input
          @click="splitBchFromTokenUtxos()"
          type="button"
          class="secondaryButton"
          style="background-color: orange; color: white; margin-bottom: 15px;"
          :value="activeAction === 'splitting' ? 'Splitting...' : 'Split BCH from Tokens'"
          :disabled="activeAction !== null"
        >
      </div>

      <!-- No issues -->
      <div v-else>
        <div><strong>Combined BCH + Token UTXOs</strong></div>
        <div class="description">
          Some dApps return UTXOs that combine BCH with tokens, causing the BCH to not show in your balance.
        </div>
        <div class="status-line text-verified" style="margin-bottom: 15px;">
          <span class="status-icon">✓</span>
          <span>You have no such UTXOs</span>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.stats-row {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.stat-value {
  font-weight: bold;
  color: var(--color-primary);
  margin-right: 3px;
}

.section {
  margin-bottom: 20px;
}

.description {
  color: var(--color-text-muted, #666);
  margin: 5px 0 10px 0;
}

.hint {
  color: var(--color-text-muted, #666);
  font-size: 13px;
  margin-top: 8px;
}

.utxo-status-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
}
.dark .utxo-status-section {
  border-top-color: #333;
}

.status-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.status-icon {
  font-weight: bold;
}

.text-warning {
  color: #e65100;
}
.dark .text-warning {
  color: #ffcc80;
}

.utxo-details {
  margin: 10px 0;
}

.utxo-details summary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 5px;
}

.utxo-details summary::-webkit-details-marker {
  display: none;
}

.utxo-details summary::marker {
  display: none;
  content: '';
}

.chevron-icon {
  width: 18px;
  height: 18px;
  transition: transform 0.2s;
}

.utxo-details[open] .chevron-icon {
  transform: rotate(180deg);
}

.utxo-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.utxo-table th,
.utxo-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #ddd);
}

.utxo-table th {
  color: var(--color-text-muted, #666);
}

.mono {
  font-family: monospace;
}

/* Responsive txid display */
.txid-mobile {
  display: none;
}
@media (max-width: 600px) {
  .txid-full {
    display: none;
  }
  .txid-mobile {
    display: inline;
  }
}

/* Dark mode */
.dark .description,
.dark .utxo-table th {
  color: #aaa;
}

.dark .utxo-table th,
.dark .utxo-table td {
  border-bottom-color: #444;
}
</style>
