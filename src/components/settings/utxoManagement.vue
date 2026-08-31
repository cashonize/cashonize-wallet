<script setup lang="ts">
  import { computed, nextTick, ref, watch } from 'vue';
  import { copyToClipboard, formatBchAmount, formatFiatAmount, formatTokenAmountFromBigInt, getFungibleTokenBalances, getTokenUtxos, satsToBch } from 'src/utils/utils';
  import EmojiItem from 'src/components/general/emojiItem.vue';
  import InfoPopup from 'src/components/general/InfoPopup.vue';
  import TokenIcon from 'src/components/general/TokenIcon.vue';
  import { HDWallet, TokenSendRequest } from 'mainnet-js';
  import type { Utxo } from 'mainnet-js';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import { maxUtxoLabelLength } from 'src/utils/wallet/utxoLabels';
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import SendCoinDialog from 'src/components/settings/sendCoinDialog.vue';
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

  // A held coin is still listed, since it is still held; the mark says a spend will not reach for
  // it. Freezing is the user's own, and theirs to undo. A pledge holds its coin until the pledge
  // itself is cancelled, so this list marks those but does not offer to release them.
  const reservedUtxoCount = computed(() => store.reservedWalletUtxos?.length);
  const reservationReason = (utxo: Utxo) => store.reservedUtxos[outpointOf(utxo)]?.reason;

  async function toggleFreeze(utxo: Utxo) {
    if (reservationReason(utxo) === 'manual') {
      await store.dropReservation(outpointOf(utxo));
      return;
    }
    // Freezing changes what the wallet reports as spendable, so it says so before it happens
    const confirmed = await confirmDialog(
      t('utxoManagement.freeze.title'),
      t('utxoManagement.freeze.message', { amount: `${formatBchAmount(Number(utxo.satoshis), false, 8)} ${bchDisplayUnit.value}` }),
      t('utxoManagement.freeze.button')
    );
    if (confirmed) await store.reserveUtxo(utxo, 'manual');
  }

  // A row's label line only exists while it has a label or its editor is open, so the menu
  // action first brings the line into the DOM and then opens its editor by ref
  const labelEditingOutpoint = ref<string | null>(null);
  const labelEditRefs: Record<string, InstanceType<typeof InlineTextEdit> | null> = {};

  function utxoLabel(utxo: Utxo): string | undefined {
    return store.utxoLabels[outpointOf(utxo)];
  }

  function setLabelEditRef(outpoint: string, componentInstance: unknown) {
    labelEditRefs[outpoint] = componentInstance as InstanceType<typeof InlineTextEdit> | null;
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
    $q.dialog({ component: SendCoinDialog, componentProps: { utxo } })
      .onOk((destinationAddress: string) => { void sendCoin(utxo, destinationAddress); });
  }

  // Sends the one coin whole, which is also the only way a frozen coin gets spent from this app
  async function sendCoin(utxo: Utxo, destinationAddress: string) {
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try {
      notifySending();
      const { txId } = await store.spend.sendCoin(utxo, destinationAddress);
      const amount = `${formatBchAmount(Number(utxo.satoshis), false, 8)} ${bchDisplayUnit.value}`;
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
  const loadingTokenData = computed(() => store.bcmrRegistries === undefined);

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

  // Enough to tell two utxos apart and to recognise one, the full value is a click away.
  // Every column holding one of these is sized to fit it whole, they never shorten further.
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

  // Commitments are up to 40 bytes and most are far shorter, so the column shows what fits and
  // its own ellipsis takes the rest. Unlike a hash there is no tail worth keeping, and leaving
  // the shortening to css is what lets the column be narrow without cutting a value twice.
  function nftCommitment(utxo: Utxo) {
    return utxo.token?.nft?.commitment || t('tokenItem.empty');
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
      await store.spend.sendMax(store.wallet.getDepositAddress())
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
        const { txId } = await store.spend.send([
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

    <div style="margin-bottom: 20px;">
      {{ t('utxoManagement.description') }}
      <InfoPopup>
        <div style="max-width: 300px;">{{ t('utxoManagement.usageHint') }}</div>
      </InfoPopup>
    </div>

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
      <div v-if="reservedUtxoCount">
        <span class="stat-value">{{ reservedUtxoCount.toLocaleString('en-US') }}</span> {{ t('utxoManagement.stats.reservedUtxos') }}
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

    <div v-if="activeFilter === 'bch' && loadingUtxos" class="loading-state">
      <template v-if="store.walletInitFailed">{{ t('utxoManagement.loadingFailed') }}</template>
      <template v-else>{{ t('utxoManagement.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <div v-else-if="activeFilter === 'tokens' && loadingTokenData" class="loading-state">
      <template v-if="store.walletInitFailed">{{ t('tokens.loadingFailed') }}</template>
      <template v-else>{{ t('tokens.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <template v-else-if="activeFilter === 'bch'">
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
              <span></span>
            </div>
            <div
              v-for="(utxo, index) in pageOf('bch')"
              :key="utxo.txid + ':' + utxo.vout"
              class="utxo-row"
              :class="{ actionable: reservationReason(utxo) !== 'pledge' }"
            >
              <div class="cell row-number">{{ rowNumber('bch', index) }}</div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }} {{ bchDisplayUnit }}</span>
              </div>
              <div v-if="isHdWallet" class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.address') }}</span>
                <span class="mono muted">{{ truncateAddress(utxo.address) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.txId') }}</span>
                <!-- .stop so copying the txid does not also open the row's actions -->
                <span class="copy-target" :title="utxo.txid" @click.stop="copyToClipboard(utxo.txid)">
                  <span class="mono muted">{{ truncateHash(utxo.txid) }}</span>
                  <img class="copyIcon" src="images/copyGrey.svg">
                </span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.vout') }}</span>
                <span class="mono">{{ utxo.vout }}</span>
              </div>
              <!-- A coin held for a pledge is marked but not actionable: cancelling the pledge is
                   what releases it. Every other coin opens its actions on a click on the row. -->
              <div class="cell held-cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.status') }}</span>
                <InfoPopup v-if="reservationReason(utxo) === 'pledge'">
                  <template #trigger>
                    <span class="held-state">
                      <q-icon name="lock" size="15px" class="held-marker" />
                      <span class="held-label">{{ t('utxoManagement.markers.reservedShort') }}</span>
                    </span>
                  </template>
                  <div style="max-width: 300px;">{{ t('utxoManagement.markers.reserved') }}</div>
                  <div class="info-popup-note" style="max-width: 300px;">{{ t('utxoManagement.markers.reservedRelease') }}</div>
                </InfoPopup>
                <template v-else>
                  <span class="held-state">
                    <q-icon
                      v-if="reservationReason(utxo) === 'manual'"
                      name="ac_unit"
                      size="15px"
                      class="held-marker frozen"
                      :title="t('utxoManagement.markers.frozen')"
                    />
                    <span class="held-label">{{
                      reservationReason(utxo) === 'manual'
                        ? t('utxoManagement.markers.frozenShort')
                        : t('utxoManagement.markers.availableShort')
                    }}</span>
                  </span>
                  <span class="held-action actions-trigger">
                    <span class="cell-label">{{ t('utxoManagement.tableHeaders.action') }}</span>
                    <q-icon name="more_vert" size="18px" />
                  </span>
                </template>
              </div>
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
              <q-menu v-if="reservationReason(utxo) !== 'pledge'" anchor="bottom right" self="top right" class="utxo-actions-menu" @hide="onMenuHidden">
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
          <div v-if="reservedUtxoCount" class="reserved-summary">
            <q-icon name="ac_unit" size="14px" class="held-marker" />
            <span>{{ t('utxoManagement.reservedSummary', reservedUtxoCount) }}</span>
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
                <EmojiItem v-if="group.holdsSignificantBch" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.utxoCount') }}</span>
                <span class="mono">{{ group.utxoCount.toLocaleString('en-US') }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bchHeld') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(group.satoshis), false, 8) }}</span>
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
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.amount') }}</span>
                <span class="mono amount-value" :title="`${fungibleAmount(utxo)} ${tokenSymbol(utxo.token!.category)}`">{{ fungibleAmount(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
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
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.capability') }}</span>
                <span>{{ nftCapability(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.commitment') }}</span>
                <span class="mono muted commitment-value" :title="utxo.token!.nft!.commitment">{{ nftCommitment(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
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
                <EmojiItem v-if="utxo.satoshis > significantBchOnTokenUtxo" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.amount') }}</span>
                <span class="mono amount-value" :title="`${fungibleAmount(utxo)} ${tokenSymbol(utxo.token!.category)}`">{{ fungibleAmount(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.capability') }}</span>
                <span>{{ nftCapability(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.commitment') }}</span>
                <span class="mono muted commitment-value" :title="utxo.token!.nft!.commitment">{{ nftCommitment(utxo) }}</span>
              </div>
              <div class="cell">
                <span class="cell-label">{{ t('utxoManagement.tableHeaders.bch') }}</span>
                <span class="mono bch-value">{{ formatBchAmount(Number(utxo.satoshis), false, 8) }}</span>
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
$col-capability: 5em;
$col-type: 5em;
$col-count: 5.5em;
/* token utxos hold dust, the BCH-only list sizes its own column wider */
$col-bch: 6em;
$col-txid: 12em;
$col-address: 9.5em;
/* the BCH-only list holds real balances rather than dust, so its amounts run longer */
$col-bch-amount: 8.5em;
/* these three shorten in css instead, so they only need to stay readable */
$col-name: 7em;
$col-amount: 5em;
$col-commitment: 8em;

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
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.utxo-row:not(.heading):hover {
  background-color: rgba(128, 128, 128, 0.08);
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
.grid-fungible .utxo-row {
  grid-template-columns: $col-number minmax($col-name, 2fr) minmax($col-amount, 1fr) $col-bch $col-txid $col-vout;
}
.grid-nft .utxo-row {
  grid-template-columns: $col-number minmax($col-name, 1fr) $col-capability $col-commitment $col-bch $col-txid $col-vout;
}
.grid-ftnft .utxo-row {
  grid-template-columns: $col-number minmax($col-name, 2fr) minmax($col-amount, 1fr) $col-capability $col-commitment $col-bch $col-txid $col-vout;
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
.warn-marker {
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

/* the mark and the offer to freeze share one column, so the row keeps its width either way */
.held-cell {
  justify-content: center;
}

.held-state,
.held-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

// the width a stacked card gives its cell labels, which the action lines up behind
$card-label-width: 90px;

/* the column is too narrow for a word beside the mark, and does not need one under a heading */
.held-label {
  display: none;
}

.held-marker {
  flex: none;
  color: grey;
}

/* the trigger is explicit on every actionable row, brightened by the row's own hover */
.actions-trigger {
  flex: none;
  cursor: pointer;
  color: grey;
  opacity: 0.55;
}
.utxo-row:hover .actions-trigger,
.actions-trigger:hover {
  opacity: 1;
}
.held-marker.frozen {
  color: var(--color-primary);
}
/* the whole row opens the actions, so the whole row says it is clickable */
.utxo-row.actionable {
  cursor: pointer;
}

/* spans every column of its row, so labels need no column of their own and only
   the rows that have one grow the extra line */
.utxo-label-line {
  grid-column: 1 / -1;
  justify-content: center;
  padding-top: 2px;
}
/* a bounded centered box, for the shown label and its editor alike, so the
   editing underline does not stretch across the whole row */
.utxo-label-line .inline-edit {
  flex: 0 1 30em;
}

.token-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* a value that outgrows its column ends in an ellipsis rather than being cut mid character.
   The token amount leaves its symbol to its title, the token column already shows it */
.bch-value,
.amount-value,
.commitment-value {
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

/* the column headings carry the meaning on a wide screen, each cell repeats its own on a narrow one */
.cell-label {
  display: none;
  color: #888;
}
.dark .cell-label {
  color: #aaa;
}

.pager {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

.mono {
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
    border: 1px solid rgba(128, 128, 128, 0.2);
    background-color: rgba(128, 128, 128, 0.06);
    border-radius: 12px;
    padding: 8px 12px;
    margin-bottom: 6px;
  }
  /* a row number means nothing once the rows no longer share a column to count down */
  .utxo-grid .utxo-row.heading,
  .utxo-grid .row-number {
    display: none;
  }
  .utxo-grid .cell-label {
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
  .utxo-grid .held-label {
    display: inline;
  }
  .utxo-grid .held-action {
    flex: 0 0 100%;
    margin-top: 4px;
  }
  /* a touch screen has no row hover to brighten the trigger, so it starts more visible */
  .utxo-grid .actions-trigger {
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
@container bch-hd-grid (max-width: 42.3em) {
  @include stacked-card;
}
@container affected-grid (max-width: 39.3em) {
  @include stacked-card;
}
@container fungible-grid (max-width: 39.3em) {
  @include stacked-card;
}
@container nft-grid (max-width: 48em) {
  @include stacked-card;
}
@container ftnft-grid (max-width: 53.7em) {
  @include stacked-card;
}
</style>

<style>
/* Global (unscoped) on purpose: the actions menu is teleported outside this component.
   Quasar's default menu surface is white, so dark mode gives it the app's own dark
   surfaces, like the inputs and pill bars get in app.css */
body.dark .utxo-actions-menu {
  background: var(--bg-secondary-color);
  color: var(--font-color);
  border: 1px solid var(--color-lightGrey);
}
</style>
