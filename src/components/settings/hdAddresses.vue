<script setup lang="ts">
  import { ref, computed, watchEffect } from 'vue';
  import { copyToClipboard, satsToBch, formatFiatAmount } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  import { HDWallet, type TestNetHDWallet, GAP_SIZE } from 'mainnet-js';
  import { useWindowSize } from 'src/utils/composables'
  import InfoPopup from 'src/components/general/InfoPopup.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480);

  interface AddressRow {
    index: number;
    address: string;
    tokenAddress: string;
    balance: bigint;
    txCount: number;
  }

  const receivingAddresses = ref<AddressRow[]>([]);
  const changeAddresses = ref<AddressRow[]>([]);
  const currentDepositIndex = ref(0);
  const selectedChain = ref("receiving" as "receiving" | "change");
  const showOptions = ref(false);
  const hideZeroBalances = ref(false);
  const showTokenAddresses = ref(false);
  const collapsedGroups = ref({ unused: false, used: false });
  const showQrDialog = ref(false);
  const qrDialogAddress = ref("");

  function toggleGroup(key: "unused" | "used") {
    collapsedGroups.value[key] = !collapsedGroups.value[key];
  }

  function openQrDialog(row: AddressRow) {
    qrDialogAddress.value = displayAddress(row);
    showQrDialog.value = true;
  }

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  function applyBalanceFilter(rows: AddressRow[]) {
    if (!hideZeroBalances.value) return rows;
    return rows.filter(r => r.balance > 0n);
  }

  const usedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(r => r.txCount > 0)));
  const unusedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(r => r.txCount === 0)));
  const usedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(r => r.txCount > 0)));
  const unusedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(r => r.txCount === 0)));

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

  // The address the wallet page QR currently hands out
  function isCurrentAddress(row: AddressRow): boolean {
    return selectedChain.value === "receiving" && row.index === currentDepositIndex.value;
  }

  // On desktop show the address prefix (bitcoincash: / bchtest:), it makes the
  // format explicit and recognizable; mobile only has room for the truncated body
  function truncateAddress(address: string) {
    const [prefix, body = ""] = address.split(':');
    if (isMobile.value) return body.slice(0, 5) + '...' + body.slice(-5);
    return prefix + ':' + body.slice(0, 8) + '...' + body.slice(-8);
  }

  function getAddressBalance(utxos: { satoshis: bigint }[]): bigint {
    return utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  }

  function buildAddressRows(hdWallet: HDWallet | TestNetHDWallet, index: number, change: boolean): AddressRow[] {
    const cache = hdWallet.walletCache;
    const rawHistory = change ? hdWallet.changeRawHistory : hdWallet.depositRawHistory;
    const rows: AddressRow[] = [];
    for (let i = 0; i < index + GAP_SIZE; i++) {
      const entry = cache.getByIndex(i, change);
      rows.push({
        index: i,
        address: entry.address,
        tokenAddress: entry.tokenAddress,
        balance: getAddressBalance(entry.utxos),
        txCount: rawHistory[i]?.length ?? 0,
      });
    }
    return rows;
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
    currentDepositIndex.value = hdWallet.depositIndex;
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
        <div
          class="address-item"
          :class="{ current: isCurrentAddress(row) }"
          v-for="row in group.rows"
          :key="row.index"
          :title="displayAddress(row)"
          @click="copyToClipboard(displayAddress(row))"
        >
          <div class="index-badge mono">{{ row.index }}</div>
          <div class="address-info">
            <div class="address-text mono">
              {{ truncateAddress(displayAddress(row)) }}
              <img class="copyIcon" src="images/copyGrey.svg">
              <span v-if="isCurrentAddress(row)" class="current-tag">{{ t('hdAddresses.currentTag') }}</span>
            </div>
            <div class="address-sub">
              {{ t('hdAddresses.txCount', { count: row.txCount }) }} ·
              <span class="mono">{{ satsToBch(row.balance) }} {{ bchDisplayUnit }}</span>
              <span v-if="row.balance && store.exchangeRate !== undefined">
                ({{ formatFiatAmount(satsToBch(row.balance) * store.exchangeRate, settingsStore.currency) }})
              </span>
            </div>
          </div>
          <span class="qr-button" @click.stop="openQrDialog(row)">
            <q-icon name="qr_code_2" size="22px" />
          </span>
        </div>
      </template>
    </template>
  </fieldset>

  <q-dialog v-model="showQrDialog" transition-show="scale" transition-hide="scale">
    <q-card class="qr-card">
      <qr-code :contents="qrDialogAddress" class="qr-code" @click="copyToClipboard(qrDialogAddress)">
        <img :src="showTokenAddresses ? 'images/tokenicon.png' : 'images/bch-icon.png'" slot="icon" /> <!-- eslint-disable-line -->
      </qr-code>
      <div class="full-address mono" @click="copyToClipboard(qrDialogAddress)">
        {{ qrDialogAddress }}
        <img class="copyIcon" src="images/copyGrey.svg">
      </div>
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

/* segmented pill bar for the receiving/change chain filter */
.type-filter {
  display: inline-flex;
  background-color: rgba(128, 128, 128, 0.12);
  border-radius: 20px;
  padding: 3px;
}

.type-filter button {
  border: none;
  margin: 0;
  background: transparent;
  color: inherit;
  border-radius: 17px;
  padding: 4px 16px;
  font-size: 0.9em;
  cursor: pointer;
}

.type-filter button.active {
  background-color: var(--color-primary);
  color: white;
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

.qr-button {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  opacity: 0.6;
}

.qr-button:hover {
  opacity: 1;
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
  background-color: #050a14;
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

.full-address {
  max-width: 260px;
  margin-top: 1rem;
  text-align: center;
  word-break: break-all;
  cursor: pointer;
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
