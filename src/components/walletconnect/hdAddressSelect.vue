<script setup lang="ts">
  import { ref, computed, watch, watchEffect } from 'vue';
  import { satsToBch, formatFiatAmount } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  import { HDWallet } from 'mainnet-js';
  import { useWindowSize } from 'src/utils/composables'
  import { buildAddressRows, type AddressRow } from 'src/utils/addressRows'
  import AddressTokenChips from 'src/components/general/AddressTokenChips.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // The wallet tools reuse this selector with their own hint text and, when the picked
  // address is one to hand out, without the change chain and without hiding the
  // unused addresses that a payment request wants in the first place
  const props = withDefaults(defineProps<{
    hint?: string,
    allowChangeAddresses?: boolean,
    hideZeroBalancesDefault?: boolean,
  }>(), {
    allowChangeAddresses: true,
    hideZeroBalancesDefault: true,
  });

  const emit = defineEmits<{
    selectionChanged: [addresses: string[]];
  }>();

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480);

  const receivingAddresses = ref<AddressRow[]>([]);
  const changeAddresses = ref<AddressRow[]>([]);
  const selectedChain = ref("receiving" as "receiving" | "change");
  const showOptions = ref(false);
  const hideZeroBalances = ref(props.hideZeroBalancesDefault);
  const collapsedGroups = ref({ unused: false, used: false });
  const selectedAddress = ref<string | null>(null);
  const expandedTokensKey = ref<string | null>(null);

  function toggleGroup(key: "unused" | "used") {
    collapsedGroups.value[key] = !collapsedGroups.value[key];
  }

  function hasTokens(row: AddressRow): boolean {
    return row.utxos.some(utxo => utxo.token);
  }

  // Labels are set on the HD addresses page, here they only help recognize an address
  function labelFor(row: AddressRow): string | undefined {
    return store.addressLabels[row.address];
  }

  function isTokensExpanded(row: AddressRow): boolean {
    return expandedTokensKey.value === selectedChain.value + row.index;
  }

  function toggleTokens(row: AddressRow) {
    const key = selectedChain.value + row.index;
    expandedTokensKey.value = expandedTokensKey.value === key ? null : key;
  }

  watch(hideZeroBalances, (newVal) => {
    if (newVal) collapsedGroups.value = { unused: false, used: false };
  });

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  function applyBalanceFilter(rows: AddressRow[]) {
    if (!hideZeroBalances.value) return rows;
    return rows.filter(row => row.balance > 0n);
  }

  const usedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(row => row.txCount > 0)));
  const unusedReceivingAddresses = computed(() => applyBalanceFilter(receivingAddresses.value.filter(row => row.txCount === 0)));
  const usedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(row => row.txCount > 0)));
  const unusedChangeAddresses = computed(() => applyBalanceFilter(changeAddresses.value.filter(row => row.txCount === 0)));

  const filteredReceivingCount = computed(() => usedReceivingAddresses.value.length + unusedReceivingAddresses.value.length);
  const filteredChangeCount = computed(() => usedChangeAddresses.value.length + unusedChangeAddresses.value.length);

  // Fresh addresses first: sharing an unused address is the main use of this dialog
  const addressGroups = computed(() => {
    const isReceiving = selectedChain.value === "receiving";
    const unused = isReceiving ? unusedReceivingAddresses.value : unusedChangeAddresses.value;
    const used = isReceiving ? usedReceivingAddresses.value : usedChangeAddresses.value;
    const groups: { key: "unused" | "used"; label: string; rows: AddressRow[] }[] = [];
    if (unused.length) groups.push({ key: "unused", label: t('hdAddresses.unusedAddresses'), rows: unused });
    if (used.length) groups.push({ key: "used", label: t('hdAddresses.usedAddresses'), rows: used });
    return groups;
  });

  // On desktop show the address prefix (bitcoincash: / bchtest:), it makes the
  // format explicit and recognizable; mobile only has room for the truncated body
  function truncateAddress(address: string) {
    const [prefix, body = ""] = address.split(':');
    if (isMobile.value) return body.slice(0, 5) + '...' + body.slice(-5);
    return prefix + ':' + body.slice(0, 8) + '...' + body.slice(-8);
  }

  function toggleAddress(address: string) {
    selectedAddress.value = selectedAddress.value === address ? null : address;
    emit('selectionChanged', selectedAddress.value ? [selectedAddress.value] : []);
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
  <div>
    <div class="control-row">
      <span>{{ props.hint ?? t('walletConnect.addressSelect.hint') }}</span>
      <span class="options-toggle" :class="{ active: showOptions }" :title="t('hdAddresses.options')" @click="showOptions = !showOptions">
        <q-icon name="tune" size="22px" />
      </span>
    </div>

    <div v-if="showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
      <div class="option-item">
        {{ t('hdAddresses.hideZeroBalances') }} <q-toggle v-model="hideZeroBalances" dense />
      </div>
    </div>

    <div v-if="props.allowChangeAddresses" class="filter-row">
      <div class="type-filter">
        <button :class="{ active: selectedChain === 'receiving' }" @click="selectedChain = 'receiving'">
          {{ t('hdAddresses.receiving') }} ({{ filteredReceivingCount }})
        </button>
        <button :class="{ active: selectedChain === 'change' }" @click="selectedChain = 'change'">
          {{ t('hdAddresses.change') }} ({{ filteredChangeCount }})
        </button>
      </div>
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
            :class="{ selected: selectedAddress === row.address, expanded: isTokensExpanded(row) }"
            :title="row.address"
            @click="toggleAddress(row.address)"
          >
            <div class="index-badge mono">{{ row.index }}</div>
            <div class="address-info">
              <div class="address-text mono">
                {{ truncateAddress(row.address) }}
                <span v-if="selectedAddress === row.address" class="selected-tag">{{ t('walletConnect.addressSelect.selectedTag') }}</span>
              </div>
              <div class="address-sub">
                {{ t('hdAddresses.txCount', { count: row.txCount }) }} ·
                <span class="mono">{{ satsToBch(row.balance) }} {{ bchDisplayUnit }}</span>
                <span v-if="row.balance && store.exchangeRate !== undefined">
                  ({{ formatFiatAmount(satsToBch(row.balance) * store.exchangeRate, settingsStore.currency) }})
                </span>
              </div>
            </div>
            <span v-if="hasTokens(row)" class="tokens-button" @click.stop="toggleTokens(row)">
              <q-icon name="expand_more" class="chevron" :class="{ open: isTokensExpanded(row) }" size="22px" />
            </span>
            <div v-if="labelFor(row)" class="address-label" :title="labelFor(row)">{{ labelFor(row) }}</div>
          </div>
          <AddressTokenChips v-if="isTokensExpanded(row)" :utxos="row.utxos" />
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
}

.options-toggle {
  cursor: pointer;
  user-select: none;
  opacity: 0.8;
  margin-left: auto;
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

.filter-row {
  margin: 10px 0;
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
  flex-wrap: wrap;
  align-items: center;
  /* the row gap only applies to the label line, which sits closer than the column spacing */
  gap: 6px 12px;
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

.address-item.selected {
  border-color: rgba(10, 193, 143, 0.5);
  background-color: rgba(10, 193, 143, 0.06);
}

/* the expanded card connects to its token panel below */
.address-item.expanded {
  border-radius: 12px 12px 0 0;
  margin-bottom: 0;
}

.tokens-button {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  opacity: 0.6;
}

.tokens-button:hover {
  opacity: 1;
}

.tokens-button .chevron {
  transition: transform 0.2s;
}

.tokens-button .chevron.open {
  transform: rotate(180deg);
}

.selected-tag {
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

/* the dialog is too narrow to fit the label next to the address, so it gets
   its own centered line under it */
.address-label {
  flex: 0 1 100%;
  min-width: 0;
  text-align: center;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mono {
  font-family: monospace;
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
