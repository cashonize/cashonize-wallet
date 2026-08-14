<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { copyToClipboard, formatBchAmount, formatFiatAmount, getFungibleTokenBalances, getTokenUtxos, satsToBch } from 'src/utils/utils';
  import EmojiItem from 'src/components/general/emojiItem.vue';
  import TokenIcon from 'src/components/general/TokenIcon.vue';
  import { HDWallet, TokenSendRequest } from 'mainnet-js';
  import type { Utxo } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const activeAction = ref<'consolidating' | 'splitting' | null>(null);

  // The page is split by asset kind because each maintenance action only concerns one half:
  // consolidating operates on the BCH-only utxos, splitting on the token utxos holding BCH.
  const activeFilter = ref<'bch' | 'tokens'>('bch');
  const collapsedLists = ref({ bch: false, tokens: false });
  const currentPage = ref(1);
  const utxosPerPage = 25;

  function toggleList(key: 'bch' | 'tokens') {
    collapsedLists.value[key] = !collapsedLists.value[key];
  }

  // TODO: consider lowering this to 1000 satoshis in the future
  // note: the bliss airdrop tool uses 2000 sats so from that point, many users would have combined UTXOs
  const significantBchOnTokenUtxo = 5_000n;

  // Consolidating spends utxos from every address at once, which only links addresses on HD wallets
  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  // Largest first, so the list reads as what consolidating would combine
  const bchUtxos = computed(() => {
    if (!store.walletUtxos) return undefined;
    return store.walletUtxos.filter(utxo => !utxo.token).sort((a, b) => Number(b.satoshis - a.satoshis));
  });
  const bchUtxoCount = computed(() => bchUtxos.value?.length);

  const totalPages = computed(() => Math.ceil((bchUtxos.value?.length ?? 0) / utxosPerPage));
  const paginatedBchUtxos = computed(() => {
    const start = (currentPage.value - 1) * utxosPerPage;
    return bchUtxos.value?.slice(start, start + utxosPerPage);
  });
  // Consolidating shortens the list, which can leave the pager past the last page
  watch(totalPages, (pageCount) => {
    if (currentPage.value > pageCount) currentPage.value = 1;
  });

  const utxosWithBchAndTokens = computed(() => {
    if (!store.walletUtxos) return undefined;
    return store.walletUtxos.filter(utxo => utxo.token?.category && utxo.satoshis > significantBchOnTokenUtxo);
  });

  // hasNftUtxos and satsToSplit are only used in template when utxosWithBchAndTokens is defined
  const hasNftUtxos = computed(() => {
    if(!utxosWithBchAndTokens.value) return undefined;
    return utxosWithBchAndTokens.value.some(utxo => utxo.token?.nft?.capability)
  });
  const satsToSplit = computed(() => {
    if(!utxosWithBchAndTokens.value) return undefined;
    return utxosWithBchAndTokens.value.reduce((sum:bigint, utxo) => sum + utxo.satoshis - 1000n, 0n)
  })

  interface TokenCategoryGroup {
    category: string;
    utxoCount: number;
    satoshis: bigint;
    holdsSignificantBch: boolean;
  }

  // Token utxos are listed per category rather than one row each: a wallet can hold hundreds of
  // them and an individual fungible utxo is not something the user acts on, the count and the BCH
  // locked up in them are. The utxos worth acting on are listed individually in the split section.
  const tokenCategoryGroups = computed(() => {
    if (!store.walletUtxos) return undefined;
    const groups: Record<string, TokenCategoryGroup> = {};
    for (const utxo of getTokenUtxos(store.walletUtxos)) {
      const category = utxo.token?.category;
      if (!category) continue; // should never happen
      const group = groups[category] ?? { category, utxoCount: 0, satoshis: 0n, holdsSignificantBch: false };
      group.utxoCount += 1;
      group.satoshis += utxo.satoshis;
      if (utxo.satoshis > significantBchOnTokenUtxo) group.holdsSignificantBch = true;
      groups[category] = group;
    }
    // Categories holding the most BCH first, those are the ones worth acting on
    return Object.values(groups).sort((a, b) => Number(b.satoshis - a.satoshis) || b.utxoCount - a.utxoCount);
  });

  function truncateHash(hash: string) {
    return hash.slice(0, 10) + '...' + hash.slice(-6);
  }

  // The prefix is the same for every row, only the body distinguishes the addresses
  function truncateAddress(address: string) {
    const body = address.split(':')[1] ?? address;
    return body.slice(0, 6) + '...' + body.slice(-6);
  }

  function tokenName(category: string) {
    return store.bcmrRegistries?.[category]?.name || truncateHash(category);
  }

  function tokenUtxoType(utxo: Utxo) {
    if (utxo.token?.amount && utxo.token.nft?.capability) return 'FT+NFT';
    return utxo.token?.amount ? 'FT' : 'NFT';
  }

  async function consolidateBchUtxos() {
    if (activeAction.value) return;
    activeAction.value = 'consolidating';
    try{
      $q.notify({
        spinner: true,
        message: t('utxoManagement.notifications.consolidating'),
        color: 'grey-5',
        timeout: 1000
      })
      await store.wallet.sendMax(store.wallet.getDepositAddress())
      $q.notify({
        type: 'positive',
        message: t('utxoManagement.notifications.consolidatedSuccess')
      })
      // update wallet state
      await store.updateWalletUtxos()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : t('utxoManagement.notifications.somethingWentWrong');
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
        if(utxo.token?.amount && !utxo.token?.nft?.capability) {
          uniqueTokenIdsToSplit.add(utxo.token.category)
        }
      })
      $q.notify({
        spinner: true,
        message: t('utxoManagement.notifications.splitting'),
        color: 'grey-5',
        timeout: 1000 * uniqueTokenIdsToSplit.size
      })
      // splitBchFromTokenUtxos esentially sends all fungible tokens
      for(const uniqueTokenIdToSplit of uniqueTokenIdsToSplit) {
        const { txId } = await store.wallet.send([
          new TokenSendRequest({
            cashaddr: store.wallet.getTokenDepositAddress(),
            amount: fungibleTokensResult[uniqueTokenIdToSplit] as bigint,
            category: uniqueTokenIdToSplit,
          }),
        ]);
        console.log(`Split BCH from Token UTXO ${uniqueTokenIdToSplit} with txid: ${txId}`);
      }
      $q.notify({
        type: 'positive',
        message: t('utxoManagement.notifications.splitSuccess')
      })
      // update wallet state once at the end
      await store.updateWalletUtxos()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : t('utxoManagement.notifications.somethingWentWrong');
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
    <legend>{{ t('utxoManagement.title') }}</legend>

    <!-- Stats -->
    <div class="stats-row">
      <div>
        <span class="stat-value">{{ store.walletUtxos?.length?.toLocaleString('en-US')  ?? '...'}}</span> {{ t('utxoManagement.stats.totalUtxos') }}
      </div>
      <div>
        <span class="stat-value">{{ bchUtxoCount?.toLocaleString('en-US') ?? '...' }}</span> {{ t('utxoManagement.stats.bchOnlyUtxos') }}
      </div>
      <div>
        <span class="stat-value">{{ store.walletUtxos ? getTokenUtxos(store.walletUtxos).length.toLocaleString('en-US') : '...' }}</span> {{ t('utxoManagement.stats.tokenUtxos') }}
      </div>
    </div>

    <!-- Asset kind, each half carries its own maintenance action and list -->
    <div class="type-filter">
      <button :class="{ active: activeFilter === 'bch' }" @click="activeFilter = 'bch'">
        {{ t('utxoManagement.filters.bch') }}
      </button>
      <button :class="{ active: activeFilter === 'tokens' }" @click="activeFilter = 'tokens'">
        {{ t('utxoManagement.filters.tokens') }}
        <span v-if="utxosWithBchAndTokens?.length" class="pill-marker">!</span>
      </button>
    </div>

    <template v-if="activeFilter === 'bch'">
      <!-- BCH-only UTXO list -->
      <div class="section">
        <div class="list-header" @click="toggleList('bch')">
          <strong>{{ t('utxoManagement.bchList.title') }}</strong>
          <span v-if="bchUtxoCount !== undefined">({{ bchUtxoCount.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.bch }" />
        </div>
        <template v-if="!collapsedLists.bch">
          <div v-if="bchUtxoCount === 0" class="description">{{ t('utxoManagement.bchList.empty') }}</div>
          <table v-else-if="paginatedBchUtxos?.length" class="utxo-table">
            <thead>
              <tr>
                <th>{{ t('utxoManagement.tableHeaders.number') }}</th>
                <th>{{ t('utxoManagement.tableHeaders.bch') }}</th>
                <th v-if="isHdWallet">{{ t('utxoManagement.tableHeaders.address') }}</th>
                <th>{{ t('utxoManagement.tableHeaders.txId') }}</th>
                <th>{{ t('utxoManagement.tableHeaders.vout') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(utxo, index) in paginatedBchUtxos" :key="utxo.txid + ':' + utxo.vout">
                <td>{{ (currentPage - 1) * utxosPerPage + index + 1 }}</td>
                <td class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</td>
                <td v-if="isHdWallet" class="mono" style="color: var(--color-grey);">{{ truncateAddress(utxo.address) }}</td>
                <td>
                  <span @click="copyToClipboard(utxo.txid)" style="cursor: pointer;">
                    <span class="txid-full mono" style="color: var(--color-grey);">{{ truncateHash(utxo.txid) }}</span>
                    <span class="txid-mobile" style="color: var(--color-grey);">{{ t('utxoManagement.tableHeaders.copy') }}</span>
                    <img class="copyIcon" src="images/copyGrey.svg">
                  </span>
                </td>
                <td class="mono">{{ utxo.vout }}</td>
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
            class="pager"
          />
        </template>
      </div>

      <!-- Consolidate BCH Section -->
      <div class="section divided">
        <div><strong>{{ t('utxoManagement.consolidate.title') }}</strong></div>
        <div class="description">
          {{ t('utxoManagement.consolidate.description') }}
        </div>
        <div v-if="isHdWallet && bchUtxoCount !== undefined && bchUtxoCount > 1" class="warning-box" style="margin-bottom: 10px;">
          <q-icon name="warning" size="20px" class="warning-box-icon" />
          <div><b>{{ t('common.attention') }}</b> {{ t('common.hdPrivacyWarning') }}</div>
        </div>
        <input
          @click="consolidateBchUtxos()"
          type="button"
          class="primaryButton"
          :value="activeAction === 'consolidating' ? t('utxoManagement.consolidate.consolidatingButton') : t('utxoManagement.consolidate.consolidateButton')"
          :disabled="activeAction !== null || (bchUtxoCount !== undefined && bchUtxoCount <= 1)"
        >
        <div v-if="bchUtxoCount !== undefined && bchUtxoCount <= 1" class="hint">
          {{ t('utxoManagement.consolidate.alreadyConsolidated', { status: bchUtxoCount === 0 ? t('utxoManagement.consolidate.noUtxos') : t('utxoManagement.consolidate.oneUtxo') }) }}
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Combined BCH + Token UTXOs -->
      <div class="section">
        <div v-if="utxosWithBchAndTokens?.length">
          <div class="status-line text-warning">
            <span class="status-icon">!</span>
            <span>{{ utxosWithBchAndTokens.length > 1 ? t('utxoManagement.combined.warningCountPlural', { count: utxosWithBchAndTokens.length }) : t('utxoManagement.combined.warningCountSingle', { count: utxosWithBchAndTokens.length }) }}</span>
          </div>
          <div class="description" v-if="satsToSplit !== undefined">
            {{ t('utxoManagement.combined.description') }}
            {{ t('utxoManagement.combined.splittableAmount', { bch: satsToBch(satsToSplit) }) }}
            <span v-if="store.exchangeRate">({{ formatFiatAmount(store.exchangeRate * satsToBch(satsToSplit), settingsStore.currency) }})</span>
          </div>

          <div v-if="hasNftUtxos" class="description" style="font-style: italic;">
            {{ t('utxoManagement.combined.nftNote') }}
          </div>

          <!-- Affected UTXOs List -->
          <details class="utxo-details">
            <summary>
              {{ t('utxoManagement.combined.viewAffected') }}
              <img
                class="icon"
                :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'"
              >
            </summary>
            <table class="utxo-table">
              <thead>
                <tr>
                  <th>{{ t('utxoManagement.tableHeaders.number') }}</th>
                  <th>{{ t('utxoManagement.tableHeaders.bch') }}</th>
                  <th>{{ t('utxoManagement.tableHeaders.token') }}</th>
                  <th>{{ t('utxoManagement.tableHeaders.type') }}</th>
                  <th>{{ t('utxoManagement.tableHeaders.txId') }}</th>
                  <th>{{ t('utxoManagement.tableHeaders.vout') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(utxo, index) in [...utxosWithBchAndTokens!].sort((a, b) => Number(b.satoshis - a.satoshis))" :key="utxo.txid + ':' + utxo.vout">
                  <td>{{ index + 1 }}</td>
                  <td class="mono">
                    {{ formatBchAmount(Number(utxo.satoshis), false, 8) }}
                    <EmojiItem v-if="utxo.satoshis > 100_000n" emoji="⚠️" :sizePx="20"/>
                  </td>
                  <td class="token-name">{{ tokenName(utxo.token!.category) }}</td>
                  <td>{{ tokenUtxoType(utxo) }}</td>
                  <td>
                    <span @click="copyToClipboard(utxo.txid)" style="cursor: pointer;">
                      <span class="txid-full mono" style="color: var(--color-grey);">{{ truncateHash(utxo.txid) }}</span>
                      <span class="txid-mobile" style="color: var(--color-grey);">{{ t('utxoManagement.tableHeaders.copy') }}</span>
                      <img class="copyIcon" src="images/copyGrey.svg">
                    </span>
                  </td>
                  <td class="mono">{{ utxo.vout }}</td>
                </tr>
              </tbody>
            </table>
          </details>

          <input
            @click="splitBchFromTokenUtxos()"
            type="button"
            class="warningButton"
            :value="activeAction === 'splitting' ? t('utxoManagement.combined.splittingButton') : t('utxoManagement.combined.splitButton')"
            :disabled="activeAction !== null"
          >
        </div>

        <!-- No issues (only show when loaded) -->
        <div v-else-if="store.walletUtxos">
          <div><strong>{{ t('utxoManagement.combined.title') }}</strong></div>
          <div class="description">
            {{ t('utxoManagement.combined.description') }}
          </div>
          <div class="status-line text-verified">
            <span class="status-icon">✓</span>
            <span>{{ t('utxoManagement.combined.noIssues') }}</span>
          </div>
        </div>
      </div>

      <!-- Token UTXOs per category -->
      <div class="section divided closing">
        <div class="list-header" @click="toggleList('tokens')">
          <strong>{{ t('utxoManagement.tokenList.title') }}</strong>
          <span v-if="tokenCategoryGroups">({{ tokenCategoryGroups.length.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.tokens }" />
        </div>
        <template v-if="!collapsedLists.tokens">
          <div v-if="tokenCategoryGroups?.length === 0" class="description">{{ t('utxoManagement.tokenList.empty') }}</div>
          <table v-else-if="tokenCategoryGroups?.length" class="utxo-table">
            <thead>
              <tr>
                <th>{{ t('utxoManagement.tableHeaders.token') }}</th>
                <th>{{ t('utxoManagement.tableHeaders.utxoCount') }}</th>
                <th>{{ t('utxoManagement.tableHeaders.bchHeld') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in tokenCategoryGroups" :key="group.category">
                <td>
                  <div class="token-cell">
                    <TokenIcon
                      :token-id="group.category"
                      :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(group.category) : undefined"
                      :size="22"
                    />
                    <span class="token-name">{{ tokenName(group.category) }}</span>
                  </div>
                </td>
                <td class="mono">{{ group.utxoCount.toLocaleString('en-US') }}</td>
                <td class="mono">
                  {{ formatBchAmount(Number(group.satoshis), false, 8) }}
                  <EmojiItem v-if="group.holdsSignificantBch" emoji="⚠️" :sizePx="18"/>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </template>
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
  margin-top: 20px;
}

/* separates the second half of a filter, so a collapsed list stays visibly its own block */
.section.divided {
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
}
.dark .section.divided {
  border-top-color: #333;
}

/* a section that ends a filter needs the same bottom margin the action buttons give theirs */
.section.closing {
  margin-bottom: 15px;
}

/* same collapse affordance as the address groups on the HD addresses page */
.list-header {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}

.list-header .chevron {
  transition: transform 0.2s;
}

.list-header .chevron.collapsed {
  transform: rotate(-90deg);
}

.description {
  color: #888;
  margin: 5px 0 10px 0;
}

.hint {
  color: #888;
  font-size: 13px;
  margin-top: 8px;
}

.pill-marker {
  color: orange;
  font-weight: bold;
  margin-left: 5px;
}
.type-filter button.active .pill-marker {
  color: white;
}

.status-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.primaryButton {
  margin-bottom: 15px;
}

.warningButton {
  background-color: orange;
  color: white;
  margin-bottom: 15px;
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

.utxo-details[open] .icon {
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
  color: #888;
}

.token-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pager {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

.mono {
  font-family: monospace;
}

/* Responsive table display */
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
@media (max-width: 500px) {
  .token-name {
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
