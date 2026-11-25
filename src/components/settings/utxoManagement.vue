<script setup lang="ts">
  import BackRow from 'src/components/general/BackRow.vue'
  import { computed, nextTick, ref, watch } from 'vue';
  import { formatDecimal } from 'src/utils/numberFormat';
  import { copyToClipboard, formatBch, formatBchAmount, formatFiatAmount, formatNumber, getFungibleTokenBalances, getTokenUtxos, satsToBch, truncateAddressBody, truncateHash } from 'src/utils/utils';
  import EmojiItem from 'src/components/general/emojiItem.vue';
  import InfoPopup from 'src/components/general/InfoPopup.vue';
  import utxoRowStatus from 'src/components/settings/utxoRowStatus.vue';
  import tokenUtxoRow from 'src/components/settings/tokenUtxoRow.vue';
  import TokenIcon from 'src/components/general/TokenIcon.vue';
  import { HDWallet, TokenSendRequest } from '@cashonize/bch-wallet-lib';
  import type { Utxo } from '@cashonize/bch-wallet-lib';
  import { isFeatureReservation, outpointOf } from 'src/utils/wallet/reservedUtxos';
  import { toTokenAddress } from 'src/utils/addressValidation';
  import { maxUtxoLabelLength } from 'src/utils/wallet/utxoLabels';
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import SendUtxoDialog from 'src/components/settings/sendUtxoDialog.vue';
  import InlineTextEdit from 'src/components/general/InlineTextEdit.vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const activeAction = ref<'consolidating' | 'splitting' | 'sending' | null>(null);

  // The page is split by asset kind because each maintenance action only concerns one half:
  // consolidating operates on the BCH-only utxos, splitting on the token utxos holding BCH.
  const activeFilter = ref<'bch' | 'tokens'>('bch');
  const utxosPerPage = 25;

  // TODO: consider lowering this to 1000 satoshis in the future
  // note: the bliss airdrop tool uses 2000 sats so from that point, many users would have combined UTXOs
  const significantBchOnTokenUtxo = 5_000n;

  // Consolidating spends utxos from every address at once, which only links addresses on HD wallets
  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  // One list per half. Largest BCH amount first, so each reads as what a spend would reach for
  // and what holds the BCH; token coins mostly hold the same dust, so those of one token follow
  // each other after that.
  const utxoLists = computed(() => {
    if (!store.walletUtxos) return undefined;
    // safe to sort in place, every array here is a fresh result of filter()
    const bch = store.walletUtxos.filter(utxo => !utxo.token)
      .sort((left, right) => Number(right.satoshis - left.satoshis));
    const tokens = store.walletUtxos.filter(utxo => utxo.token).sort((left, right) =>
      Number(right.satoshis - left.satoshis) || tokenName(left.token!.category).localeCompare(tokenName(right.token!.category))
    );
    return { bch, tokens };
  });
  type UtxoList = keyof NonNullable<typeof utxoLists.value>;

  // The search runs over both halves, the kind filter over the token coins only. A coin holding
  // a fungible amount and an NFT at once is listed under both kinds.
  const searchQuery = ref('');
  const tokenKindFilter = ref<'all' | 'fungibles' | 'nfts'>('all');
  const tokenKindOptions = [
    { value: 'all', label: 'tokens.typeFilter.all' },
    { value: 'fungibles', label: 'tokens.typeFilter.fungibles' },
    { value: 'nfts', label: 'tokens.typeFilter.nfts' },
  ] as const;

  // What a coin can be found by: where it is, what it holds and what the user called it. Built
  // once per set of coins rather than on every keystroke.
  const searchTexts = computed(() => {
    const texts = new Map<string, string>();
    for (const utxo of store.walletUtxos ?? []) {
      const outpoint = outpointOf(utxo);
      const fields = [utxo.address, toTokenAddress(utxo.address), outpoint, store.utxoLabels[outpoint]];
      if (utxo.token) {
        const metadata = store.bcmrRegistries?.[utxo.token.category];
        fields.push(utxo.token.category, metadata?.name, metadata?.token?.symbol, utxo.token.nft?.commitment);
      }
      texts.set(outpoint, fields.filter(Boolean).join(' ').toLowerCase());
    }
    return texts;
  });

  const shownLists = computed(() => {
    if (!utxoLists.value) return undefined;
    let tokens = utxoLists.value.tokens;
    if (tokenKindFilter.value === 'fungibles') tokens = tokens.filter(utxo => utxo.token?.amount);
    if (tokenKindFilter.value === 'nfts') tokens = tokens.filter(utxo => utxo.token?.nft);
    const query = searchQuery.value.toLowerCase().trim();
    if (!query) return { bch: utxoLists.value.bch, tokens };
    const matches = (utxo: Utxo) => searchTexts.value.get(outpointOf(utxo))?.includes(query);
    return { bch: utxoLists.value.bch.filter(matches), tokens: tokens.filter(matches) };
  });

  // The row's first line differs per kind: a fungible amount, an NFT, or both
  function tokenKind(utxo: Utxo) {
    if (utxo.token?.amount && utxo.token.nft) return 'ftNft';
    return utxo.token?.amount ? 'fungible' : 'nft';
  }

  const bchUtxoCount = computed(() => utxoLists.value?.bch.length);

  // A held coin is still listed, since it is still held; the mark says a spend will not reach for
  // it. Freezing is the user's own, and theirs to undo. A pledge and an authhead are held by the
  // feature that made the reservation, so this list marks those but does not offer to release them.
  const reservedUtxoCount = computed(() => store.reservedWalletUtxos?.length);
  const reservationReason = (utxo: Utxo) => store.reservedUtxos[outpointOf(utxo)];
  // The mark on a row only hints at it, so each half says out loud how many of its coins are held
  const heldBchCount = computed(() => utxoLists.value?.bch.filter(reservationReason).length);
  const heldTokenCount = computed(() => {
    if (!utxoLists.value) return undefined;
    return utxoLists.value.tokens.filter(reservationReason).length;
  });
  const heldByFeature = (utxo: Utxo) => isFeatureReservation(reservationReason(utxo));

  async function toggleFreeze(utxo: Utxo) {
    if (reservationReason(utxo) === 'manual') {
      await store.dropReservation(outpointOf(utxo));
      return;
    }
    // Freezing changes what the wallet reports as spendable, so it says so before it happens
    const amount = formatBch(utxo.satoshis, store.network);
    const confirmed = await confirmDialog(
      t('utxoManagement.freeze.title'),
      utxo.token
        ? t('utxoManagement.freeze.messageToken', { amount })
        : t('utxoManagement.freeze.message', { amount }),
      t('utxoManagement.freeze.button')
    );
    if (confirmed) await store.reserveOutpoints([outpointOf(utxo)], 'manual');
  }

  // A row's label line only exists while it has a label or its editor is open, so the menu
  // action first brings the line into the DOM and then opens its editor by ref: the editor
  // itself on a grid row, the token row on the two-line list, which forwards to its editor
  const labelEditingOutpoint = ref<string | null>(null);
  interface LabelEditor { startEdit: () => Promise<void> }
  const labelEditRefs: Record<string, LabelEditor | null> = {};

  function utxoLabel(utxo: Utxo): string | undefined {
    return store.utxoLabels[outpointOf(utxo)];
  }

  function setLabelEditRef(outpoint: string, componentInstance: unknown) {
    labelEditRefs[outpoint] = componentInstance as LabelEditor | null;
  }

  async function openLabelEditor(utxo: Utxo) {
    const outpoint = outpointOf(utxo);
    labelEditingOutpoint.value = outpoint;
    await nextTick();
    await labelEditRefs[outpoint]?.startEdit();
  }

  // Opening the editor straight from the menu click races the closing menu, which can pull
  // focus back and blur the fresh editor shut, so the edit waits until the menu has hidden
  let pendingLabelUtxo: Utxo | null = null;
  function queueLabelEdit(utxo: Utxo) {
    pendingLabelUtxo = utxo;
  }
  function onMenuHidden() {
    if (!pendingLabelUtxo) return;
    const utxo = pendingLabelUtxo;
    pendingLabelUtxo = null;
    void openLabelEditor(utxo);
  }

  function saveLabel(utxo: Utxo, label: string) {
    store.setUtxoLabel(outpointOf(utxo), label);
    labelEditingOutpoint.value = null;
  }

  function openSendDialog(utxo: Utxo) {
    $q.dialog({ component: SendUtxoDialog, componentProps: { utxo } })
      .onOk((destinationAddress: string) => { void sendUtxo(utxo, destinationAddress); });
  }

  // Sends the one coin whole, which is also the only way a frozen coin gets spent from this app
  async function sendUtxo(utxo: Utxo, destinationAddress: string) {
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try {
      notifySending();
      const { txId } = await store.spend.sendUtxo(utxo, destinationAddress);
      const amount = formatBch(utxo.satoshis, store.network);
      await handleTransactionBroadcastSuccess(
        t('utxoManagement.send.sent', { amount, address: destinationAddress }),
        txId,
        t('utxoManagement.send.success')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      activeAction.value = null;
    }
  }

  const loadingUtxos = computed(() => store.walletUtxos === undefined);
  // fetched after the utxos, and it carries the decimals a fungible amount is shown in
  const loadingTokenData = computed(() => !store.tokenMetadataLoaded);

  // the per-category overview has nothing to act on, so it opens closed
  const collapsedLists = ref({ bch: false, tokens: true });
  const listPages = ref<Record<UtxoList, number>>({ bch: 1, tokens: 1 });

  function toggleList(key: keyof typeof collapsedLists.value) {
    collapsedLists.value[key] = !collapsedLists.value[key];
  }

  function pageCount(list: UtxoList) {
    return Math.ceil((shownLists.value?.[list].length ?? 0) / utxosPerPage);
  }
  function pageOf(list: UtxoList) {
    const start = (listPages.value[list] - 1) * utxosPerPage;
    return shownLists.value?.[list].slice(start, start + utxosPerPage);
  }
  function rowNumber(list: UtxoList, index: number) {
    return (listPages.value[list] - 1) * utxosPerPage + index + 1;
  }

  // Consolidating or splitting shortens a list, which can leave its pager past the last page
  watch(shownLists, () => {
    for (const list of Object.keys(listPages.value) as UtxoList[]) {
      if (listPages.value[list] > pageCount(list)) listPages.value[list] = 1;
    }
  });
  // a narrowed list is read from its start
  watch([searchQuery, tokenKindFilter], () => {
    listPages.value = { bch: 1, tokens: 1 };
  });

  const utxosWithBchAndTokens = computed(() => {
    if (!store.walletUtxos) return undefined;
    return store.walletUtxos.filter(utxo => utxo.token?.category && utxo.satoshis > significantBchOnTokenUtxo);
  });

  // The wallet tools menu marks this page when token utxos hold BCH, and that is all the mark
  // ever means, so the half it points at is the one to open. The utxos load after the page
  // does, hence the watch, and it runs for the first set of each wallet only: after that the
  // shown half is the user's to pick and nothing switches under them.
  let openedOnAlert = false;
  watch(utxosWithBchAndTokens, (affectedUtxos) => {
    if (openedOnAlert || affectedUtxos === undefined) return;
    openedOnAlert = true;
    if (affectedUtxos.length) activeFilter.value = 'tokens';
  }, { immediate: true });

  // The page is cached for the whole session, so without this a wallet switched to after the
  // first one would keep whichever half the wallet before it opened, mark or no mark
  watch(() => [store.activeWalletName, store.network], () => {
    openedOnAlert = false;
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

  function tokenName(category: string) {
    return store.bcmrRegistries?.[category]?.name || truncateHash(category, 8, 6);
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
      await store.spend.sendMax(store.currentDepositAddress)
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
      // the amounts a send can reach: a held back coin of the category stays where it is
      const tokenUtxos = getTokenUtxos(store.spendableUtxos ?? []);
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
        // a category whose coins are all held back has nothing a send can reach
        const amount = fungibleTokensResult[uniqueTokenIdToSplit] ?? 0n;
        if (amount <= 0n) continue;
        const { txId } = await store.spend.send([
          new TokenSendRequest({
            cashaddr: store.currentTokenDepositAddress,
            amount,
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
    <BackRow @click="store.goBack()" />

    <div style="margin-bottom: 20px;">
      {{ t('utxoManagement.description') }}
      <InfoPopup>
        <div style="max-width: 300px;">{{ t('utxoManagement.usageHint') }}</div>
      </InfoPopup>
    </div>

    <div class="stats-row">
      <div>
        <span class="stat-value">{{ store.walletUtxos ? formatDecimal(store.walletUtxos.length) : '...' }}</span> {{ t('utxoManagement.stats.totalUtxos') }}
      </div>
      <div>
        <span class="stat-value">{{ bchUtxoCount === undefined ? '...' : formatDecimal(bchUtxoCount) }}</span> {{ t('utxoManagement.stats.bchOnlyUtxos') }}
      </div>
      <div>
        <span class="stat-value">{{ store.walletUtxos ? formatDecimal(getTokenUtxos(store.walletUtxos).length) : '...' }}</span> {{ t('utxoManagement.stats.tokenUtxos') }}
      </div>
      <div v-if="reservedUtxoCount">
        <span class="stat-value">{{ formatDecimal(reservedUtxoCount) }}</span> {{ t('utxoManagement.stats.reservedUtxos') }}
      </div>
    </div>

    <!-- Asset kind, each half carries its own maintenance action and lists -->
    <div class="control-row">
      <div class="type-filter">
        <button :class="{ active: activeFilter === 'bch' }" @click="activeFilter = 'bch'">
          {{ t('utxoManagement.filters.bch') }}
        </button>
        <button :class="{ active: activeFilter === 'tokens' }" @click="activeFilter = 'tokens'">
          {{ t('utxoManagement.filters.tokens') }}
          <span v-if="utxosWithBchAndTokens?.length" class="pill-marker">!</span>
        </button>
      </div>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="t('utxoManagement.searchPlaceholder')"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
      >
    </div>

    <div v-if="activeFilter === 'bch' && loadingUtxos" class="loading-state">
      <template v-if="store.walletInitFailed">{{ t('utxoManagement.loadingFailed') }}</template>
      <template v-else>{{ t('utxoManagement.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <div v-else-if="activeFilter === 'tokens' && loadingTokenData" class="loading-state">
      <template v-if="store.walletInitFailed">{{ t('tokens.loadingFailed') }}</template>
      <template v-else>{{ t('tokens.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <template v-else-if="activeFilter === 'bch'">
      <div class="section">
        <div class="list-header" @click="toggleList('bch')">
          <strong>{{ t('utxoManagement.bchList.title') }}</strong>
          <span v-if="shownLists">({{ formatDecimal(shownLists.bch.length) }})</span>
          <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedLists.bch }" />
        </div>
        <template v-if="!collapsedLists.bch">
          <div v-if="bchUtxoCount === 0" class="description">{{ t('utxoManagement.bchList.empty') }}</div>
          <div v-else-if="shownLists?.bch.length === 0" class="description">{{ t('utxoManagement.noMatch') }}</div>
          <div v-else class="utxo-grid" :class="isHdWallet ? 'grid-bch-hd' : 'grid-bch'">
            <div class="utxo-row heading">
              <span>{{ t('utxoManagement.tableHeaders.number') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.bch') }}</span>
              <span v-if="isHdWallet">{{ t('utxoManagement.tableHeaders.address') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.txId') }}</span>
              <span>{{ t('utxoManagement.tableHeaders.vout') }}</span>
              <span></span>
            </div>
            <div
              v-for="(utxo, index) in pageOf('bch')"
              :key="utxo.txid + ':' + utxo.vout"
              class="utxo-row"
              :class="{ actionable: !heldByFeature(utxo) }"
            >
              <div class="cell row-number">{{ rowNumber('bch', index) }}</div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono bch-value">{{ formatBch(utxo.satoshis, store.network) }}</span>
              </div>
              <div v-if="isHdWallet" class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.address') }}</span>
                <!-- .stop so copying does not also open the row's actions -->
                <span class="copy-target" :title="utxo.address" @click.stop="copyToClipboard(utxo.address)">
                  <span class="mono muted">{{ truncateAddressBody(utxo.address) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <span class="copy-target" :title="utxo.txid" @click.stop="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid, 8, 6) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
              <!-- a coin held by a feature has no actions here: that feature releases it -->
              <utxoRowStatus :utxo="utxo" />
              <!-- The label spans the whole row as a line of its own, so it needs no column and
                   rows without one keep their height. It edits in place: a click on the text
                   opens the editor directly, the menu action opens it for an unlabeled row. -->
              <div
                v-if="utxoLabel(utxo) || labelEditingOutpoint === outpointOf(utxo)"
                class="cell utxo-label-line"
              >
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.label') }}</span>
                <InlineTextEdit
                  :ref="(componentInstance) => setLabelEditRef(outpointOf(utxo), componentInstance)"
                  class="utxo-label-edit"
                  :value="utxoLabel(utxo)"
                  :hint="t('utxoManagement.label.placeholder')"
                  :max-length="maxUtxoLabelLength"
                  @save="(label) => saveLabel(utxo, label)"
                  @cancel="labelEditingOutpoint = null"
                />
              </div>
              <!-- Attached to the row itself, so a click anywhere on it opens the actions -->
              <q-menu v-if="!heldByFeature(utxo)" anchor="bottom right" self="top right" @hide="onMenuHidden">
                <q-list dense>
                  <q-item clickable v-close-popup @click="toggleFreeze(utxo)">
                    <q-item-section avatar><q-icon name="ac_unit" size="18px" /></q-item-section>
                    <q-item-section>{{
                      reservationReason(utxo) === 'manual'
                        ? t('utxoManagement.markers.unfreeze')
                        : t('utxoManagement.freeze.button')
                    }}</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="openSendDialog(utxo)">
                    <q-item-section avatar><q-icon name="send" size="18px" /></q-item-section>
                    <q-item-section>{{ t('utxoManagement.send.title') }}</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="queueLabelEdit(utxo)">
                    <q-item-section avatar><q-icon name="edit" size="18px" /></q-item-section>
                    <q-item-section>{{ t('utxoManagement.label.title') }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </div>
          </div>
          <!-- Says out loud what a mark on one row only hints at, and why the spendable balance
               is smaller than the coins listed here add up to -->
          <div v-if="heldBchCount" class="reserved-summary">
            <span>{{ t('utxoManagement.reservedSummary', heldBchCount) }}</span>
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

      <div class="section divided">
        <div><strong>{{ t('utxoManagement.consolidate.title') }}</strong></div>
        <div class="description">
          {{ t('utxoManagement.consolidate.description') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('utxoManagement.consolidate.usageHint') }}</div>
          </InfoPopup>
        </div>
        <div v-if="isHdWallet && bchUtxoCount !== undefined && bchUtxoCount > 1" class="warning-box" style="margin-bottom: 10px;">
          <q-icon name="warning" size="20px" class="warning-box-icon" />
          <div><b>{{ t('common.attention') }}</b> {{ t('common.hdPrivacyWarning') }}</div>
        </div>
        <!-- Consolidating spends from the same pool as everything else, so it reaches for no coin
             being held back. Saying so beforehand, since the result is a coin left uncombined -->
        <div v-if="reservedUtxoCount" class="description">
          {{ t('utxoManagement.consolidate.heldExcluded') }}
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
      <!-- BCH sitting on token coins is the one thing to act on here, so the warning and the
           per-token overview that shows where it sits only appear when there is some -->
      <div v-if="affectedUtxos?.length" class="section">
        <div>
          <div class="status-line text-warning">
            <span class="status-icon">!</span>
            <span>{{ affectedUtxos.length > 1 ? t('utxoManagement.combined.warningCountPlural', { count: affectedUtxos.length }) : t('utxoManagement.combined.warningCountSingle', { count: affectedUtxos.length }) }}</span>
          </div>
          <div class="description" v-if="satsToSplit !== undefined">
            {{ t('utxoManagement.combined.description') }}
            {{ t('utxoManagement.combined.splittableAmount', { bch: formatNumber(satsToBch(satsToSplit), 8) }) }}
            <span v-if="store.exchangeRate">({{ formatFiatAmount(store.exchangeRate * satsToBch(satsToSplit), settingsStore.currency) }})</span>
          </div>

          <div v-if="hasNftUtxos" class="description" style="font-style: italic;">
            {{ t('utxoManagement.combined.nftNote') }}
          </div>

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
                  <EmojiItem v-if="utxo.satoshis > 100_000n" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.largeBch')"/>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.type') }}</span>
                  <span>{{ tokenUtxoType(utxo) }}</span>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                  <span class="mono bch-value">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
                </div>
                <div class="cell">
                  <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                  <span class="copy-target" :title="utxo.txid" @click="copyToClipboard(utxo.txid)">
                    <span class="mono muted">{{ truncateHash(utxo.txid, 8, 6) }}</span>
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

      </div>

      <div v-if="affectedUtxos?.length" class="section divided">
        <div class="list-header" @click="toggleList('tokens')">
          <strong>{{ t('utxoManagement.tokenList.title') }}</strong>
          <span v-if="tokenCategoryGroups">({{ formatDecimal(tokenCategoryGroups.length) }})</span>
          <EmojiItem
            v-if="collapsedLists.tokens && tokenCategoryGroups?.some(group => group.holdsSignificantBch)"
            class="warn-marker"
            emoji="⚠️"
            :sizePx="16"
            :title="t('utxoManagement.markers.bchOnToken')"
          />
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
                <EmojiItem v-if="group.holdsSignificantBch" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.utxoCount') }}</span>
                <span class="mono">{{ formatDecimal(group.utxoCount) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bchHeld') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(group.satoshis), false, 8) }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="section closing" :class="{ divided: affectedUtxos?.length }">
        <div class="token-list-header">
          <strong>{{ t('utxoManagement.stats.tokenUtxos') }}</strong>
          <span v-if="shownLists">({{ formatDecimal(shownLists.tokens.length) }})</span>
          <div class="type-filter kind-filter">
            <button
              v-for="option in tokenKindOptions"
              :key="option.value"
              :class="{ active: tokenKindFilter === option.value }"
              @click="tokenKindFilter = option.value"
            >{{ t(option.label) }}</button>
          </div>
        </div>
        <div v-if="utxoLists?.tokens.length === 0" class="description">{{ t('utxoManagement.tokenList.empty') }}</div>
        <div v-else-if="shownLists?.tokens.length === 0" class="description">{{ t('utxoManagement.noMatch') }}</div>
        <div v-else class="utxo-lines">
          <tokenUtxoRow
            v-for="utxo in pageOf('tokens')"
            :key="utxo.txid + ':' + utxo.vout"
            :ref="(componentInstance) => setLabelEditRef(outpointOf(utxo), componentInstance)"
            :utxo="utxo"
            :show-address="isHdWallet"
            :kind="tokenKind(utxo)"
            :holds-significant-bch="utxo.satoshis > significantBchOnTokenUtxo"
            :editing-label="labelEditingOutpoint === outpointOf(utxo)"
            @toggle-freeze="toggleFreeze(utxo)"
            @edit-label="queueLabelEdit(utxo)"
            @menu-hidden="onMenuHidden"
            @save-label="(label) => saveLabel(utxo, label)"
            @cancel-label="labelEditingOutpoint = null"
          />
        </div>
        <q-pagination
          v-if="pageCount('tokens') > 1"
          v-model="listPages.tokens"
          :max="pageCount('tokens')"
          input
          direction-links
          color="primary"
          class="pager"
        />
        <!-- counts every held token coin, not only the ones a search or filter leaves -->
        <div v-if="heldTokenCount" class="reserved-summary">
          <span>{{ t('utxoManagement.reservedTokenSummary', heldTokenCount) }}</span>
        </div>
      </div>
    </template>
  </fieldset>
</template>

<style scoped lang="scss">
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

:deep(.description) {
  color: #888;
  margin: 5px 0 10px 0;
}
.dark :deep(.description) {
  color: #aaa;
}

.hint {
  color: #888;
  font-size: 13px;
  margin-top: 8px;
}

/* the half pills with the search beside them, on its own line once they no longer fit */
.control-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
}
/* the width the token page's search has */
.search-input {
  width: 180px;
  margin: 0 0 0 auto;
  padding: 4px 10px;
}
.token-list-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.kind-filter {
  margin-left: auto;
}
.kind-filter button {
  padding: 3px 12px;
  font-size: 0.85em;
}
@media (max-width: 600px) {
  .search-input {
    flex-basis: 100%;
    width: 100%;
    margin-left: 0;
  }
}

.loading-state {
  margin-top: 20px;
  text-align: center;
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

/* Everything a row is built from is in em, so the widths below and the widths a list stacks
   at stay in step with each other whatever font size the grid is given */
$gap: 0.7em;
$row-padding-x: 0.45em;

/* Wide enough to fit their value whole, so it is never cut a second time by an ellipsis */
$col-number: 1.9em;
$col-vout: 3em;
/* wide enough for a frozen marker and the actions trigger side by side */
$col-held: 3em;
$col-type: 5em;
$col-count: 5.5em;
/* token utxos hold dust, the BCH-only list sizes its own column wider */
$col-bch: 6em;
$col-txid: 12em;
$col-address: 11.5em;
/* the BCH-only list holds real balances rather than dust, so its amounts run longer */
$col-bch-amount: 8.5em;
/* these three shorten in css instead, so they only need to stay readable */
$col-name: 7em;

/* Aligned columns like a table on wide screens, one stacked card per utxo when they no longer
   fit. Grid rather than a real table because a table can only overflow where a grid can re-lay
   its columns. Every row of a list shares its column template, so the columns line up.
   The font size is fixed here because the column widths are in em: a row that sized its own
   text differently would compute different columns and break the alignment. */
.utxo-grid {
  margin-top: 10px;
  font-size: 14px;
  container-type: inline-size;
  /* a webview too old for container queries never stacks, so it would overflow the page
     with the columns at their narrowest instead. There it scrolls the list rather than
     the page, everywhere else the list has stacked long before it can overflow */
  overflow-x: auto;
}

.utxo-row {
  display: grid;
  align-items: center;
  column-gap: $gap;
  padding: 7px $row-padding-x;
  border-bottom: 1px solid var(--surface-line);
}

.utxo-row:not(.heading):hover {
  background-color: var(--surface-subtle);
}

.utxo-row.heading {
  color: #888;
  padding-bottom: 5px;
}
.dark .utxo-row.heading {
  color: #aaa;
}

/* The slack all goes to the token name and amount, the only two columns that vary in length */
.grid-bch .utxo-row {
  grid-template-columns: $col-number minmax($col-bch-amount, 1fr) minmax($col-txid, 1fr) $col-vout $col-held;
}
.grid-bch-hd .utxo-row {
  grid-template-columns: $col-number minmax($col-bch-amount, 1fr) minmax($col-address, 1fr) minmax($col-txid, 1fr) $col-vout $col-held;
}
.grid-categories .utxo-row {
  grid-template-columns: minmax($col-name, 1fr) $col-count $col-bch;
}
.grid-affected .utxo-row {
  grid-template-columns: $col-number minmax($col-name, 1fr) $col-type $col-bch $col-txid $col-vout;
}
/* A token coin on two lines: what it is and what can be done with it, then where it is. Table
   density with card readability, and it stacks on a phone where the table could not. The row is
   a child component, so the rules for its insides are :deep, as the status cell's are. */
.utxo-lines {
  margin-top: 8px;
}
.utxo-line-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--color-lightGrey);
}
:deep(.utxo-line) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* the second line reads as detail under the first, indented past the icon */
:deep(.utxo-line-meta) {
  margin-left: 32px;
  color: grey;
  font-size: 0.9em;
  flex-wrap: wrap;
  /* wider than the first line's: each value here ends in its copy icon, which a narrow gap
     would read as belonging to the next one */
  gap: 2px 20px;
}
/* a label and its value stay together when the line wraps */
:deep(.meta-field) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
:deep(.meta-label) {
  opacity: 0.75;
}
:deep(.utxo-line-meta .mono) {
  color: var(--font-color);
}
:deep(.line-spacer) {
  flex: 1;
}
:deep(.utxo-line-meta .copy-target) {
  display: inline-flex;
  align-items: center;
}
.utxo-line-row :deep(.utxo-label-line) {
  margin-left: 32px;
}
/* the menu sits at the end of the row, where the eye leaves it */
:deep(.row-menu-trigger) {
  margin-left: auto;
  cursor: pointer;
}
:deep(.held-state-compact) {
  display: inline-flex;
  align-items: center;
}

.cell {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
}

.row-number {
  opacity: 0.5;
}

.token-cell {
  gap: 8px;
}

/* the icon is the token's identity, it gives up no width to the name beside it */
.token-cell > :first-child {
  flex: none;
}

/* the marker sits in the token column because that one is flexible, so the name shortens for it */
:deep(.warn-marker) {
  flex: none;
}

.reserved-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: #888;
  font-size: 0.9em;
}
.dark .reserved-summary {
  color: #aaa;
}

/* The status cell is its own component, so the rules for what is inside it reach through the
   scope with :deep. Its root element keeps this component's scope, so .held-cell does not.
   Inside the token row it is nested a level deeper still, which :deep reaches all the same.
   The mark and the offer to freeze share one column, so the row keeps its width either way. */
.held-cell {
  justify-content: center;
}

:deep(.held-state),
:deep(.held-action) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

// the width a stacked card gives its cell labels, which the action lines up behind
$card-label-width: 90px;

/* the column is too narrow for a word beside the mark, and does not need one under a heading */
:deep(.held-label) {
  display: none;
}

:deep(.held-marker) {
  flex: none;
  color: grey;
}

/* the trigger is explicit on every actionable row, brightened by the row's own hover */
:deep(.actions-trigger) {
  flex: none;
  cursor: pointer;
  color: grey;
  opacity: 0.55;
}
.utxo-row:hover :deep(.actions-trigger),
:deep(.actions-trigger:hover) {
  opacity: 1;
}
:deep(.held-marker.frozen) {
  color: var(--color-frozen);
}
/* the whole row opens the actions, so the whole row says it is clickable */
.utxo-row.actionable {
  cursor: pointer;
}

/* spans every column of its row, so labels need no column of their own and only
   the rows that have one grow the extra line */
:deep(.utxo-label-line) {
  grid-column: 1 / -1;
  justify-content: center;
  padding-top: 2px;
}
/* a bounded centered box, for the shown label and its editor alike, so the
   editing underline does not stretch across the whole row */
:deep(.utxo-label-line .inline-edit) {
  flex: 0 1 30em;
}

:deep(.token-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* a value that outgrows its column ends in an ellipsis rather than being cut mid character */
:deep(.bch-value),
:deep(.amount-value) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.nft-type) {
  white-space: nowrap;
}

:deep(.muted) {
  color: var(--color-grey);
}

/* the copy icon belongs to the txid it copies, never floating on its own */
:deep(.copy-target) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  cursor: pointer;
}

:deep(.copy-target .mono) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* the column headings carry the meaning on a wide screen, each cell repeats its own on a narrow one */
:deep(.cell-label) {
  display: none;
  color: #888;
}
.dark :deep(.cell-label) {
  color: #aaa;
}

.pager {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

:deep(.mono) {
  font-family: monospace;
}

/* Once the columns no longer fit the utxo becomes a stacked card and every value carries the
   heading it lost. Neutral grey alphas keep the cards theme-agnostic.
   The width that matters is the list's own, not the window's: the page caps its width, so a
   wide window still leaves a list narrower than its columns need. Hence container queries,
   each list named so it can stack at the width its own set of columns stops fitting. */
@mixin stacked-card {
  .utxo-grid .utxo-row {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 1px;
    border: 1px solid var(--surface-line);
    background-color: var(--surface-faint);
    border-radius: 12px;
    padding: 8px 12px;
    margin-bottom: 6px;
  }
  /* a row number means nothing once the rows no longer share a column to count down */
  .utxo-grid .utxo-row.heading,
  .utxo-grid .row-number {
    display: none;
  }
  .utxo-grid :deep(.cell-label) {
    display: inline;
    min-width: $card-label-width;
  }
  /* A card has the room to say what a coin is and what can be done to it separately. The state
     reads on the cell's own line, the actions trigger drops to its own beneath it, under a
     label of its own like every other value here. */
  .utxo-grid .held-cell {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .utxo-grid :deep(.held-label) {
    display: inline;
  }
  .utxo-grid :deep(.held-action) {
    flex: 0 0 100%;
    margin-top: 4px;
  }
  /* a touch screen has no row hover to brighten the trigger, so it starts more visible */
  .utxo-grid :deep(.actions-trigger) {
    opacity: 0.75;
  }
}

.grid-bch { container-name: bch-grid; }
.grid-bch-hd { container-name: bch-hd-grid; }
.grid-categories { container-name: categories-grid; }
.grid-affected { container-name: affected-grid; }
.grid-fungible { container-name: fungible-grid; }
.grid-nft { container-name: nft-grid; }
.grid-ftnft { container-name: ftnft-grid; }

/* Each width is that list's own columns added up, so a list gives up its columns the moment
   they stop fitting. Raising one does not gain room, it only takes the columns away earlier.
   In em rather than the px the breakpoints elsewhere in the app use: those describe a device,
   these describe a sum of em column widths, and in px would drift from it. */
@container categories-grid (max-width: 20.8em) {
  @include stacked-card;
}
@container bch-grid (max-width: 32.1em) {
  @include stacked-card;
}
@container bch-hd-grid (max-width: 44.3em) {
  @include stacked-card;
}
@container affected-grid (max-width: 39.3em) {
  @include stacked-card;
}
@container fungible-grid (max-width: 43em) {
  @include stacked-card;
}
@container nft-grid (max-width: 51.7em) {
  @include stacked-card;
}
@container ftnft-grid (max-width: 57.4em) {
  @include stacked-card;
}
</style>
