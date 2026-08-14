<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { copyToClipboard, formatBchAmount, formatFiatAmount, formatTokenAmountFromBigInt, getFungibleTokenBalances, getTokenUtxos, satsToBch } from 'src/utils/utils';
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
  const utxosPerPage = 25;

  // TODO: consider lowering this to 1000 satoshis in the future
  // note: the bliss airdrop tool uses 2000 sats so from that point, many users would have combined UTXOs
  const significantBchOnTokenUtxo = 5_000n;

  // Consolidating spends utxos from every address at once, which only links addresses on HD wallets
  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  // The utxos are listed per kind, because what there is to see about one differs per kind: a
  // fungible amount, an NFT capability and commitment, or both at once. Largest BCH amount first
  // throughout, so every list reads as what a spend would reach for and what holds the BCH.
  const utxoLists = computed(() => {
    if (!store.walletUtxos) return undefined;
    // safe to sort in place, every array here is a fresh result of filter()
    const largestFirst = (utxos: Utxo[]) => utxos.sort((left, right) => Number(right.satoshis - left.satoshis));
    return {
      bch: largestFirst(store.walletUtxos.filter(utxo => !utxo.token)),
      fungible: largestFirst(store.walletUtxos.filter(utxo => utxo.token?.amount && !utxo.token.nft)),
      nft: largestFirst(store.walletUtxos.filter(utxo => utxo.token?.nft && !utxo.token.amount)),
      ftNft: largestFirst(store.walletUtxos.filter(utxo => utxo.token?.amount && utxo.token.nft)),
    };
  });
  type UtxoList = keyof NonNullable<typeof utxoLists.value>;

  const bchUtxoCount = computed(() => utxoLists.value?.bch.length);

  const collapsedLists = ref({ bch: false, tokens: false, fungible: true, nft: true, ftNft: true });
  const listPages = ref<Record<UtxoList, number>>({ bch: 1, fungible: 1, nft: 1, ftNft: 1 });

  function toggleList(key: keyof typeof collapsedLists.value) {
    collapsedLists.value[key] = !collapsedLists.value[key];
  }

  function pageCount(list: UtxoList) {
    return Math.ceil((utxoLists.value?.[list].length ?? 0) / utxosPerPage);
  }
  function pageOf(list: UtxoList) {
    const start = (listPages.value[list] - 1) * utxosPerPage;
    return utxoLists.value?.[list].slice(start, start + utxosPerPage);
  }
  function rowNumber(list: UtxoList, index: number) {
    return (listPages.value[list] - 1) * utxosPerPage + index + 1;
  }

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  // Consolidating or splitting shortens a list, which can leave its pager past the last page
  watch(utxoLists, () => {
    for (const list of Object.keys(listPages.value) as UtxoList[]) {
      if (listPages.value[list] > pageCount(list)) listPages.value[list] = 1;
    }
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

  const affectedUtxos = computed(() => {
    if (!utxosWithBchAndTokens.value) return undefined;
    return [...utxosWithBchAndTokens.value].sort((left, right) => Number(right.satoshis - left.satoshis));
  });

  interface TokenCategoryGroup {
    category: string;
    utxoCount: number;
    satoshis: bigint;
    holdsSignificantBch: boolean;
  }

  // Token utxos also get a per category summary, above the per utxo lists: with hundreds of them
  // the count and the BCH locked up per token is what tells the user whether there is anything to
  // clean up, which no individual row shows.
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
    return hash.slice(0, 8) + '...' + hash.slice(-6);
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

  function tokenSymbol(category: string) {
    return store.bcmrRegistries?.[category]?.token?.symbol ?? '';
  }

  function fungibleAmount(utxo: Utxo) {
    const token = utxo.token;
    if (!token) return ''; // should never happen
    const decimals = store.bcmrRegistries?.[token.category]?.token?.decimals ?? 0;
    return formatTokenAmountFromBigInt(token.amount, decimals);
  }

  function nftCapability(utxo: Utxo) {
    const capability = utxo.token?.nft?.capability;
    if (!capability) return ''; // should never happen
    return capability === 'none' ? t('tokenItem.info.immutable') : capability;
  }

  // Commitments are up to 40 bytes, too wide to show in full in a column
  function nftCommitment(utxo: Utxo) {
    const commitment = utxo.token?.nft?.commitment;
    if (!commitment) return t('tokenItem.empty');
    if (commitment.length > 20) return commitment.slice(0, 10) + '...' + commitment.slice(-6);
    return commitment;
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

    <!-- Asset kind, each half carries its own maintenance action and lists -->
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
          <div v-else class="utxo-grid" :class="isHdWallet ? 'grid-bch-hd' : 'grid-bch'">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
              <span v-if="isHdWallet">{{ t('utxoManagement.tableHeaders.address') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
            </div>
            <div v-for="(utxo, index) in pageOf('bch')" :key="utxo.txid + ':' + utxo.vout" class="utxo-row">
              <div class="cell row-number">{{ rowNumber('bch', index) }}</div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }} {{ bchDisplayUnit }}</span>
              </div>
              <div v-if="isHdWallet" class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.address') }}</span>
                <span class="mono muted">{{ truncateAddress(utxo.address) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
            </div>
          </div>
          <q-pagination
            v-if="pageCount('bch') > 1"
            v-model="listPages.bch"
            :max="pageCount('bch')"
            input
            direction-links
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
        <div v-if="affectedUtxos?.length">
          <div class="status-line text-warning">
            <span class="status-icon">!</span>
            <span>{{ affectedUtxos.length > 1 ? t('utxoManagement.combined.warningCountPlural', { count: affectedUtxos.length }) : t('utxoManagement.combined.warningCountSingle', { count: affectedUtxos.length }) }}</span>
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
            <div class="utxo-grid grid-affected">
              <div class="utxo-row heading">
                <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
                <span>{{ t('utxoManagement.tableHeaders.token') }}</span>
                <span>{{ t('utxoManagement.tableHeaders.type') }}</span>
                <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
              </div>
              <div v-for="(utxo, index) in affectedUtxos" :key="utxo.txid + ':' + utxo.vout" class="utxo-row">
                <div class="cell row-number">{{ index + 1 }}</div>
                <div class="cell token-cell">
                  <TokenIcon
                    :token-id="utxo.token!.category"
                    :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(utxo.token!.category) : undefined"
                    :size="24"
                  />
                  <span class="token-name">{{ tokenName(utxo.token!.category) }}</span>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.type') }}</span>
                  <span>{{ tokenUtxoType(utxo) }}</span>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                  <span class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
                  <EmojiItem v-if="utxo.satoshis > 100_000n" emoji="⚠️" :sizePx="16"/>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                  <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                    <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                    <img class="copyIcon" src="images/copyGrey.svg">
                  </span>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                  <span class="mono">{{ utxo.vout }}</span>
                </div>
              </div>
            </div>
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
      <div class="section divided">
        <div class="list-header" @click="toggleList('tokens')">
          <strong>{{ t('utxoManagement.tokenList.title') }}</strong>
          <span v-if="tokenCategoryGroups">({{ tokenCategoryGroups.length.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.tokens }" />
        </div>
        <template v-if="!collapsedLists.tokens">
          <div v-if="tokenCategoryGroups?.length === 0" class="description">{{ t('utxoManagement.tokenList.empty') }}</div>
          <div v-else-if="tokenCategoryGroups?.length" class="utxo-grid grid-categories">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.token') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.utxoCount') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bchHeld') }}</span>
            </div>
            <div v-for="group in tokenCategoryGroups" :key="group.category" class="utxo-row">
              <div class="cell token-cell">
                <TokenIcon
                  :token-id="group.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(group.category) : undefined"
                  :size="24"
                />
                <span class="token-name">{{ tokenName(group.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.utxoCount') }}</span>
                <span class="mono">{{ group.utxoCount.toLocaleString('en-US') }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bchHeld') }}</span>
                <span class="mono">{{ formatBchAmount(Number(group.satoshis), false, 8) }}</span>
                <EmojiItem v-if="group.holdsSignificantBch" emoji="⚠️" :sizePx="16"/>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Fungible token UTXOs -->
      <div class="section divided">
        <div class="list-header" @click="toggleList('fungible')">
          <strong>{{ t('utxoManagement.fungibleList.title') }}</strong>
          <span v-if="utxoLists">({{ utxoLists.fungible.length.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.fungible }" />
        </div>
        <template v-if="!collapsedLists.fungible">
          <div v-if="utxoLists?.fungible.length === 0" class="description">{{ t('utxoManagement.fungibleList.empty') }}</div>
          <div v-else class="utxo-grid grid-fungible">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.token') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.amount') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
            </div>
            <div v-for="(utxo, index) in pageOf('fungible')" :key="utxo.txid + ':' + utxo.vout" class="utxo-row">
              <div class="cell row-number">{{ rowNumber('fungible', index) }}</div>
              <div class="cell token-cell">
                <TokenIcon
                  :token-id="utxo.token!.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(utxo.token!.category) : undefined"
                  :size="24"
                />
                <span class="token-name">{{ tokenName(utxo.token!.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.amount') }}</span>
                <span class="mono">{{ fungibleAmount(utxo) }} {{ tokenSymbol(utxo.token!.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" emoji="⚠️" :sizePx="16"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
            </div>
          </div>
          <q-pagination
            v-if="pageCount('fungible') > 1"
            v-model="listPages.fungible"
            :max="pageCount('fungible')"
            input
            direction-links
            color="primary"
            class="pager"
          />
        </template>
      </div>

      <!-- NFT UTXOs -->
      <div class="section divided">
        <div class="list-header" @click="toggleList('nft')">
          <strong>{{ t('utxoManagement.nftList.title') }}</strong>
          <span v-if="utxoLists">({{ utxoLists.nft.length.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.nft }" />
        </div>
        <template v-if="!collapsedLists.nft">
          <div v-if="utxoLists?.nft.length === 0" class="description">{{ t('utxoManagement.nftList.empty') }}</div>
          <div v-else class="utxo-grid grid-nft">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.token') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.capability') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.commitment') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
            </div>
            <div v-for="(utxo, index) in pageOf('nft')" :key="utxo.txid + ':' + utxo.vout" class="utxo-row">
              <div class="cell row-number">{{ rowNumber('nft', index) }}</div>
              <div class="cell token-cell">
                <TokenIcon
                  :token-id="utxo.token!.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(utxo.token!.category) : undefined"
                  :size="24"
                />
                <span class="token-name">{{ tokenName(utxo.token!.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.capability') }}</span>
                <span>{{ nftCapability(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.commitment') }}</span>
                <span class="mono muted" :title="utxo.token!.nft!.commitment">{{ nftCommitment(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" emoji="⚠️" :sizePx="16"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
            </div>
          </div>
          <q-pagination
            v-if="pageCount('nft') > 1"
            v-model="listPages.nft"
            :max="pageCount('nft')"
            input
            direction-links
            color="primary"
            class="pager"
          />
        </template>
      </div>

      <!-- UTXOs holding a fungible amount and an NFT at once -->
      <div class="section divided closing">
        <div class="list-header" @click="toggleList('ftNft')">
          <strong>{{ t('utxoManagement.ftNftList.title') }}</strong>
          <span v-if="utxoLists">({{ utxoLists.ftNft.length.toLocaleString('en-US') }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.ftNft }" />
        </div>
        <template v-if="!collapsedLists.ftNft">
          <div v-if="utxoLists?.ftNft.length === 0" class="description">{{ t('utxoManagement.ftNftList.empty') }}</div>
          <div v-else class="utxo-grid grid-ftnft">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.token') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.amount') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.capability') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.commitment') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
            </div>
            <div v-for="(utxo, index) in pageOf('ftNft')" :key="utxo.txid + ':' + utxo.vout" class="utxo-row">
              <div class="cell row-number">{{ rowNumber('ftNft', index) }}</div>
              <div class="cell token-cell">
                <TokenIcon
                  :token-id="utxo.token!.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(utxo.token!.category) : undefined"
                  :size="24"
                />
                <span class="token-name">{{ tokenName(utxo.token!.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.amount') }}</span>
                <span class="mono">{{ fungibleAmount(utxo) }} {{ tokenSymbol(utxo.token!.category) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.capability') }}</span>
                <span>{{ nftCapability(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.commitment') }}</span>
                <span class="mono muted" :title="utxo.token!.nft!.commitment">{{ nftCommitment(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" emoji="⚠️" :sizePx="16"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
            </div>
          </div>
          <q-pagination
            v-if="pageCount('ftNft') > 1"
            v-model="listPages.ftNft"
            :max="pageCount('ftNft')"
            input
            direction-links
            color="primary"
            class="pager"
          />
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
.dark .description {
  color: #aaa;
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

/* Aligned columns like a table on desktop, one stacked card per utxo on a phone. Grid rather
   than a real table because a table can only overflow where a grid can re-lay its columns.
   Every row of a list shares its column template, so the columns line up down the list. */
.utxo-grid {
  margin-top: 10px;
}

.utxo-row {
  display: grid;
  align-items: center;
  column-gap: 12px;
  padding: 7px 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.utxo-row:not(.heading):hover {
  background-color: rgba(128, 128, 128, 0.08);
}

.utxo-row.heading {
  color: #888;
  font-size: 0.85em;
  padding-bottom: 5px;
}
.dark .utxo-row.heading {
  color: #aaa;
}

.grid-bch .utxo-row {
  grid-template-columns: 34px minmax(0, 1.4fr) minmax(0, 1.4fr) 60px;
}
.grid-bch-hd .utxo-row {
  grid-template-columns: 34px minmax(0, 1.3fr) minmax(0, 1.2fr) minmax(0, 1.3fr) 60px;
}
.grid-categories .utxo-row {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.2fr);
}
.grid-affected .utxo-row {
  grid-template-columns: 34px minmax(0, 1.6fr) minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1.3fr) 60px;
}
.grid-fungible .utxo-row {
  grid-template-columns: 34px minmax(0, 1.6fr) minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.3fr) 60px;
}
.grid-nft .utxo-row {
  grid-template-columns: 34px minmax(0, 1.5fr) minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.3fr) 60px;
}
.grid-ftnft .utxo-row {
  grid-template-columns: 34px minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.3fr) 60px;
}

.cell {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.row-number {
  opacity: 0.5;
}

.token-cell {
  gap: 8px;
}

.token-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: var(--color-grey);
}

/* the copy icon belongs to the txid it copies, never floating on its own */
.copy-target {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  cursor: pointer;
}

.copy-target:active .copyIcon {
  transform: scale(1.2);
}

.copy-target .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* the column headings carry the meaning on desktop, each cell repeats its own on a phone */
.cell-label {
  display: none;
}

.pager {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

.mono {
  font-family: monospace;
}

/* Below this the columns no longer fit side by side, so each utxo becomes a stacked card and
   every value carries the heading it lost. Neutral grey alphas keep the cards theme-agnostic. */
@media only screen and (max-width: 700px) {
  .utxo-grid .utxo-row {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 1px;
    border: 1px solid rgba(128, 128, 128, 0.2);
    background-color: rgba(128, 128, 128, 0.06);
    border-radius: 12px;
    padding: 8px 12px;
    margin-bottom: 6px;
    font-size: 0.9em;
  }
  .utxo-grid .utxo-row.heading,
  .utxo-grid .row-number {
    display: none;
  }
  .cell-label {
    display: inline;
    color: #888;
    min-width: 90px;
  }
  .dark .cell-label {
    color: #aaa;
  }
}
</style>
