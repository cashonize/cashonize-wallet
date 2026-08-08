<script setup lang="ts">
  import { ref, computed, watchEffect } from 'vue';
  import { copyToClipboard, satsToBch, formatFiatAmount } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  import { HDWallet } from 'mainnet-js';
  import { useWindowSize } from 'src/utils/composables'
  import { maxAddressLabelLength } from 'src/utils/addressManagement'
  import { buildAddressRows, type AddressRow } from 'src/utils/addressRows'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import AddressTokenChips from 'src/components/general/AddressTokenChips.vue'
  import InlineTextEdit from 'src/components/general/InlineTextEdit.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480);

  const receivingAddresses = ref<AddressRow[]>([]);
  const changeAddresses = ref<AddressRow[]>([]);
  const selectedChain = ref("receiving" as "receiving" | "change");
  const showOptions = ref(false);
  const hideZeroBalances = ref(false);
  const showTokenAddresses = ref(false);
  const collapsedGroups = ref({ unused: false, used: false });
  const showQrDialog = ref(false);
  const qrDialogRow = ref<AddressRow | null>(null);
  const qrDialogTokenAddress = ref(false);
  const expandedTokensKey = ref<string | null>(null);
  const showLabelDialog = ref(false);
  const labelDialogRow = ref<AddressRow | null>(null);
  const labelDraft = ref("");

  function isMarked(row: AddressRow): boolean {
    return store.addressMarks.includes(row.address);
  }

  function labelFor(row: AddressRow): string | undefined {
    return store.addressLabels[row.address];
  }

  function openLabelDialog(row: AddressRow) {
    labelDialogRow.value = row;
    labelDraft.value = labelFor(row) ?? "";
    showLabelDialog.value = true;
  }

  // The label autosaves on dialog close (enter, escape or backdrop click)
  function saveLabel() {
    const row = labelDialogRow.value;
    if (!row) return;
    store.setAddressLabel(row.address, labelDraft.value);
  }

  function toggleGroup(key: "unused" | "used") {
    collapsedGroups.value[key] = !collapsedGroups.value[key];
  }

  function hasTokens(row: AddressRow): boolean {
    return row.utxos.some(utxo => utxo.token);
  }

  function isTokensExpanded(row: AddressRow): boolean {
    return expandedTokensKey.value === selectedChain.value + row.index;
  }

  function toggleTokens(row: AddressRow) {
    const key = selectedChain.value + row.index;
    expandedTokensKey.value = expandedTokensKey.value === key ? null : key;
  }

  function openQrDialog(row: AddressRow) {
    qrDialogRow.value = row;
    qrDialogTokenAddress.value = showTokenAddresses.value;
    showQrDialog.value = true;
  }

  const qrDialogAddress = computed(() => {
    const row = qrDialogRow.value;
    if (!row) return "";
    return qrDialogTokenAddress.value ? row.tokenAddress : row.address;
  });

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  function applyBalanceFilter(rows: AddressRow[]) {
    if (!hideZeroBalances.value) return rows;
    return rows.filter(row => row.balance > 0n);
  }

  // Addresses the user marked as used are grouped under used: they are no longer handed out
  const usedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(row => row.txCount > 0 || isMarked(row))));
  const unusedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(row => row.txCount === 0 && !isMarked(row))));
  const usedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(row => row.txCount > 0)));
  const unusedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(row => row.txCount === 0)));

  const filteredReceivingCount = computed(() => usedReceivingAddresses.value.length + unusedReceivingAddresses.value.length);
  const filteredChangeCount = computed(() => usedChangeAddresses.value.length + unusedChangeAddresses.value.length);

  // Fresh addresses first: handing out an unused address is the main use of this page
  const addressGroups = computed(() => {
    const isReceiving = selectedChain.value === "receiving";
    const unused = isReceiving ? unusedReceivingAddresses.value : unusedChangeAddresses.value;
    const used = isReceiving ? usedReceivingAddresses.value : usedChangeAddresses.value;
    const groups: { key: "unused" | "used"; label: string; rows: AddressRow[] }[] = [];
    if (unused.length) groups.push({ key: "unused", label: t('hdAddresses.unusedAddresses'), rows: unused });
    if (used.length) groups.push({ key: "used", label: t('hdAddresses.usedAddresses'), rows: used });
    return groups;
  });

  function displayAddress(row: AddressRow) {
    return showTokenAddresses.value ? row.tokenAddress : row.address;
  }

  // The address the wallet page QR currently hands out. Compared by address rather than
  // index so the tag follows the wallet page even when it falls back to the wallet's own
  // deposit address, which is not always the address at hdWallet.depositIndex.
  function isCurrentAddress(row: AddressRow): boolean {
    return selectedChain.value === "receiving" && row.address === store.currentDepositAddress;
  }

  // On desktop show the address prefix (bitcoincash: / bchtest:), it makes the
  // format explicit and recognizable; mobile only has room for the truncated body
  function truncateAddress(address: string) {
    const [prefix, body = ""] = address.split(':');
    if (isMobile.value) return body.slice(0, 5) + '...' + body.slice(-5);
    return prefix + ':' + body.slice(0, 8) + '...' + body.slice(-8);
  }

  // Rebuild when walletUtxos changes (triggers on balance/address updates)
  watchEffect(() => {
    // Access walletUtxos to establish reactive dependency
    void store.walletUtxos;
    const hdWallet = store.wallet;
    // wallet can briefly be non-HD mid wallet-switch
    // KeepAlive preserves this HD-only view, so its watchEffect can rerun after setWallet()
    // swaps in a single-address wallet but before changeView(1) navigates away.
    if (!(hdWallet instanceof HDWallet)) return;
    receivingAddresses.value = buildAddressRows(hdWallet, hdWallet.depositIndex, false);
    changeAddresses.value = buildAddressRows(hdWallet, hdWallet.changeIndex, true);
  });
</script>

<template>
  <fieldset class="item">
    <legend>{{ t('hdAddresses.title') }}</legend>

    <div class="control-row">
      <div class="type-filter">
        <button :class="{ active: selectedChain === 'receiving' }" @click="selectedChain = 'receiving'">
          {{ t('hdAddresses.receiving') }} ({{ filteredReceivingCount }})
        </button>
        <button :class="{ active: selectedChain === 'change' }" @click="selectedChain = 'change'">
          {{ t('hdAddresses.change') }} ({{ filteredChangeCount }})
        </button>
      </div>
      <span class="options-toggle" :class="{ active: showOptions }" :title="t('hdAddresses.options')" @click="showOptions = !showOptions">
        <q-icon name="tune" size="22px" />
      </span>
    </div>

    <div v-if="showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
      <div class="option-item">
        {{ t('hdAddresses.hideZeroBalances') }} <q-toggle v-model="hideZeroBalances" dense />
      </div>
      <div class="option-item">
        {{ t('hdAddresses.showTokenAddresses') }} <q-toggle v-model="showTokenAddresses" dense />
      </div>
    </div>

    <div class="intro">
      {{ t('hdAddresses.intro') }}
      <InfoPopup>
        <div style="max-width: 320px;">
          <div>{{ t('hdAddresses.infoReceivingChange') }}</div>
          <div class="info-popup-note">{{ t('hdAddresses.infoPrivacyNote') }}</div>
          <div class="info-popup-note">{{ t('addressManagement.markedInfo') }}</div>
          <div class="info-popup-note">{{ t('addressManagement.markLimitInfo') }}</div>
        </div>
      </InfoPopup>
    </div>

    <div v-if="!addressGroups.length" class="description">{{ t('hdAddresses.noAddresses') }}</div>

    <template v-for="group in addressGroups" :key="group.key">
      <div class="group-header" @click="toggleGroup(group.key)">
        {{ group.label }} ({{ group.rows.length }})
        <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedGroups[group.key] }" />
      </div>
      <template v-if="!collapsedGroups[group.key]">
        <template v-for="row in group.rows" :key="row.index">
          <div
            class="address-item"
            :class="{ current: isCurrentAddress(row), expanded: isTokensExpanded(row) }"
            :title="displayAddress(row)"
            @click="copyToClipboard(displayAddress(row))"
          >
            <div class="index-badge mono">{{ row.index }}</div>
            <div class="address-info">
              <div class="address-text mono">
                {{ truncateAddress(displayAddress(row)) }}
                <img class="copyIcon" src="images/copyGrey.svg">
                <span v-if="isCurrentAddress(row)" class="current-tag">{{ t('hdAddresses.currentTag') }}</span>
                <!-- both tags can show at once: with no fresh address left the wallet falls
                     back to handing out an address that was already marked as used -->
                <span v-if="isMarked(row)" class="marked-tag">{{ t('addressManagement.markedTag') }}</span>
              </div>
              <div class="address-sub">
                <span v-if="isMobile && labelFor(row)" class="address-label">{{ labelFor(row) }} · </span>{{ t('hdAddresses.txCount', { count: row.txCount }) }} ·
                <span class="mono">{{ satsToBch(row.balance) }} {{ bchDisplayUnit }}</span>
                <span v-if="row.balance && store.exchangeRate !== undefined">
                  ({{ formatFiatAmount(satsToBch(row.balance) * store.exchangeRate, settingsStore.currency) }})
                </span>
              </div>
            </div>
            <!-- labels edit inline in the empty middle of the row, the hint appears on hover -->
            <InlineTextEdit
              v-if="!isMobile"
              class="label-inline"
              :value="labelFor(row)"
              :hint="t('addressManagement.labelPlaceholder')"
              :max-length="maxAddressLabelLength"
              @save="(label) => store.setAddressLabel(row.address, label)"
            />
            <div class="card-buttons">
              <span v-if="isMobile" class="label-button" :title="t('addressManagement.editLabel')" @click.stop="openLabelDialog(row)">
                <q-icon name="edit" size="20px" />
              </span>
              <span
                v-if="selectedChain === 'receiving' && row.txCount === 0 && !isMarked(row)"
                class="mark-button"
                :title="t('addressManagement.markAddressUsed')"
                @click.stop="store.markAddressUsed(row.address)"
              >
                <q-icon name="archive" size="22px" />
              </span>
              <span
                v-if="isMarked(row)"
                class="mark-button"
                :title="t('addressManagement.unmarkAddressUsed')"
                @click.stop="store.unmarkAddressUsed(row.address)"
              >
                <q-icon name="unarchive" size="22px" />
              </span>
              <span v-if="hasTokens(row)" class="tokens-button" @click.stop="toggleTokens(row)">
                <q-icon name="expand_more" class="chevron" :class="{ open: isTokensExpanded(row) }" size="22px" />
              </span>
              <span class="qr-button" @click.stop="openQrDialog(row)">
                <q-icon name="qr_code_2" size="22px" />
              </span>
            </div>
          </div>
          <AddressTokenChips v-if="isTokensExpanded(row)" :utxos="row.utxos" />
        </template>
      </template>
    </template>
  </fieldset>

  <q-dialog v-model="showQrDialog" transition-show="scale" transition-hide="scale">
    <q-card class="qr-card">
      <qr-code :contents="qrDialogAddress" class="qr-code" @click="copyToClipboard(qrDialogAddress)">
        <img :src="qrDialogTokenAddress ? 'images/tokenicon.png' : 'images/bch-icon.png'" slot="icon" /> <!-- eslint-disable-line -->
      </qr-code>
      <div v-if="qrDialogRow && labelFor(qrDialogRow)" class="qr-address-label">{{ labelFor(qrDialogRow) }}</div>
      <div class="full-address mono" @click="copyToClipboard(qrDialogAddress)">
        {{ qrDialogAddress }}
        <img class="copyIcon" src="images/copyGrey.svg">
      </div>
      <div class="switch-address" @click="qrDialogTokenAddress = !qrDialogTokenAddress">
        <span class="switchAddressButton" :class="{ flipped: qrDialogTokenAddress }">⇄</span>
        {{ qrDialogTokenAddress ? t('hdAddresses.changeToRegularAddress') : t('hdAddresses.changeToTokenAddress') }}
      </div>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showLabelDialog" @hide="saveLabel" transition-show="scale" transition-hide="scale">
    <q-card class="label-card">
      <div class="label-title">{{ t('addressManagement.editLabel') }}</div>
      <div v-if="labelDialogRow" class="label-address mono">{{ truncateAddress(labelDialogRow.address) }}</div>
      <label class="labelField">
        <input
          v-model="labelDraft"
          type="text"
          :placeholder="t('addressManagement.labelPlaceholder')"
          :maxlength="maxAddressLabelLength"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="showLabelDialog = false"
        >
        <!-- silent maxlength truncation is confusing, show the limit when writing gets close -->
        <span
          v-if="labelDraft.length >= maxAddressLabelLength - 20"
          class="labelCounter"
          :class="{ atLimit: labelDraft.length >= maxAddressLabelLength }"
        >{{ labelDraft.length }}/{{ maxAddressLabelLength }}</span>
        <q-icon name="edit" size="16px" class="labelIcon" />
      </label>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.intro {
  margin: 10px 0;
}

.control-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin: 10px 0;
}

.options-toggle {
  cursor: pointer;
  user-select: none;
  opacity: 0.8;
  margin-left: auto;
}

/* icons are taller than the lowercase text, drop them slightly below the
   baseline so they read as vertically centered next to it */
.options-toggle .q-icon {
  vertical-align: -0.2em;
}

.options-toggle.active {
  color: var(--color-primary);
  opacity: 1;
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

.description {
  opacity: 0.6;
  margin: 5px 0 10px 0;
}

.group-header {
  text-transform: uppercase;
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin: 14px 2px 6px;
  cursor: pointer;
  user-select: none;
}

.group-header .chevron {
  vertical-align: -0.2em;
  transition: transform 0.2s;
}

.group-header .chevron.collapsed {
  transform: rotate(-90deg);
}

/* neutral grey alphas keep the cards theme-agnostic: no separate dark mode rules needed */
.address-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 6px;
  font-size: 0.85em;
  cursor: pointer;
  transition: background-color 0.2s;
}

.address-item:hover {
  background-color: rgba(128, 128, 128, 0.14);
}

/* the whole card is the copy target, so pressing it anywhere plays the copy effect */
.address-item:active .copyIcon {
  transform: scale(1.2);
}

.address-item.current {
  border-color: rgba(10, 193, 143, 0.5);
}

.current-tag {
  background-color: rgba(10, 193, 143, 0.15);
  color: var(--color-primary);
  border-radius: 10px;
  padding: 0 8px;
  margin-left: 2px;
}

.marked-tag {
  background-color: rgba(128, 128, 128, 0.15);
  opacity: 0.8;
  border-radius: 10px;
  padding: 0 8px;
  margin-left: 2px;
}

.address-label {
  font-weight: 500;
}

.label-inline {
  flex: 1;
  /* enlarge the click target without growing the row */
  padding: 10px 8px;
  margin: -10px 0;
}

/* rows without a label reveal the hint on hover */
.address-item:hover :deep(.inline-edit-hint) {
  opacity: 0.55;
}

.index-badge {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(128, 128, 128, 0.15);
}

.card-buttons {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.qr-button,
.tokens-button,
.label-button,
.mark-button {
  display: inline-flex;
  align-items: center;
  opacity: 0.6;
}

.qr-button:hover,
.tokens-button:hover,
.label-button:hover,
.mark-button:hover {
  opacity: 1;
}

.tokens-button .chevron {
  transition: transform 0.2s;
}

.tokens-button .chevron.open {
  transform: rotate(180deg);
}

/* the expanded card connects to its token panel below */
.address-item.expanded {
  border-radius: 12px 12px 0 0;
  margin-bottom: 0;
}

.address-info {
  min-width: 0;
}

.address-text {
  display: flex;
  align-items: center;
  gap: 4px;
}

.address-sub {
  font-size: 0.85em;
  opacity: 0.65;
}

.mono {
  font-family: monospace;
}

.qr-card {
  padding: 1.5rem;
  background-color: #fff;
}
body.dark .qr-card {
  background-color: var(--bg-color);
}

/* the qr-code needs a white background to stay scannable in dark mode */
.qr-code {
  display: block;
  width: 230px;
  height: 225px;
  margin: 0 auto;
  background-color: #fff;
  cursor: pointer;
}

.switch-address {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.8em;
  opacity: 0.75;
  cursor: pointer;
  user-select: none;
}

.switchAddressButton {
  font-size: 20px;
  font-weight: 700;
  transition: transform 0.3s;
}

/* flip around the vertical axis: the glyph's ink is horizontally centered in its box
   but sits below the vertical center (text baseline), so an in-plane rotate(180deg)
   would visibly displace it */
.switchAddressButton.flipped {
  transform: rotateY(180deg);
}

.full-address {
  max-width: 260px;
  margin-top: 1rem;
  text-align: center;
  word-break: break-all;
  cursor: pointer;
}

.qr-address-label {
  max-width: 260px;
  margin-top: 1rem;
  text-align: center;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.label-card {
  padding: 1.5rem;
  width: 320px;
  max-width: 90vw;
  background-color: #fff;
}
body.dark .label-card {
  background-color: var(--bg-color);
}

.label-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.label-address {
  font-size: 0.85em;
  opacity: 0.65;
  margin-bottom: 12px;
}

.labelField {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 8px;
  background-color: rgba(128, 128, 128, 0.06);
  transition: border-color 0.2s;
  cursor: text;
}

.labelField:focus-within {
  border-color: var(--color-primary);
}

.labelField input {
  flex: 1;
  min-width: 0;
  width: auto;
  border: none;
  background: transparent;
  margin: 0;
  padding: 0;
}

.labelIcon {
  flex: none;
  opacity: 0.55;
}

.labelCounter {
  font-size: 0.75em;
  opacity: 0.6;
}

.labelCounter.atLimit {
  color: #e6a23c;
  opacity: 1;
}

@media only screen and (max-width: 600px) {
  .type-filter button {
    padding: 4px 12px;
    font-size: 0.85em;
  }
  .address-item {
    padding: 8px 10px;
  }
}
</style>
