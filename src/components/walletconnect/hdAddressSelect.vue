<script setup lang="ts">
  import { ref, computed, watch, watchEffect } from 'vue';
  import { satsToBch } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  import { HDWallet, type TestNetHDWallet, GAP_SIZE } from 'mainnet-js';
  import { useWindowSize } from 'src/utils/composables'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const emit = defineEmits<{
    selectionChanged: [addresses: string[]];
  }>();

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480);

  interface AddressRow {
    index: number;
    address: string;
    balance: bigint;
    txCount: number;
  }

  const receivingAddresses = ref<AddressRow[]>([]);
  const changeAddresses = ref<AddressRow[]>([]);
  const showUsedReceiving = ref(true);
  const showUsedChange = ref(true);
  const showOptions = ref(false);
  const hideZeroBalances = ref(true);
  const collapsedSections = ref({ receiving: false, change: false });
  const selectedAddresses = ref(new Set<string>());

  function toggleSection(key: "receiving" | "change") {
    collapsedSections.value[key] = !collapsedSections.value[key];
  }

  watch(hideZeroBalances, (newVal) => {
    if (newVal) {
      showUsedReceiving.value = true;
      showUsedChange.value = true;
      collapsedSections.value = { receiving: false, change: false };
    }
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

  function truncateAddress(address: string) {
    const body = address.split(':')[1] ?? "";
    const chars = isMobile.value ? 5 : 8;
    return body.slice(0, chars) + '...' + body.slice(-chars);
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
        balance: getAddressBalance(entry.utxos),
        txCount: rawHistory[i]?.length ?? 0,
      });
    }
    return rows;
  }

  function toggleAddress(address: string) {
    if (selectedAddresses.value.has(address)) {
      selectedAddresses.value = new Set();
    } else {
      selectedAddresses.value = new Set([address]);
    }
    emit('selectionChanged', [...selectedAddresses.value]);
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
      <span>{{ t('walletConnect.addressSelect.hint') }}</span>
      <span class="options-toggle" :class="{ active: showOptions }" :title="t('hdAddresses.options')" @click="showOptions = !showOptions">
        <q-icon name="tune" size="22px" />
      </span>
    </div>

    <div v-if="showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
      <div class="option-item">
        {{ t('hdAddresses.hideZeroBalances') }} <q-toggle v-model="hideZeroBalances" dense />
      </div>
    </div>

    <!-- Receiving Addresses -->
    <div class="group-header" @click="toggleSection('receiving')">
      {{ t('hdAddresses.receivingAddresses') }} ({{ filteredReceivingCount }})
      <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedSections.receiving }" />
    </div>
    <template v-if="!collapsedSections.receiving">
      <table v-if="filteredReceivingCount" class="address-table">
        <thead>
          <tr>
            <th></th>
            <th>{{ t('hdAddresses.columns.index') }}</th>
            <th>{{ t('hdAddresses.columns.address') }}</th>
            <th>{{ t('hdAddresses.columns.balance') }}</th>
            <th>{{ t('hdAddresses.columns.txs') }}</th>
          </tr>
        </thead>
        <!-- Used receiving addresses (collapsible) -->
        <tbody v-if="usedReceivingAddresses.length">
          <tr class="section-toggle" @click="showUsedReceiving = !showUsedReceiving">
            <td colspan="5">
              {{ t('hdAddresses.usedAddresses') }} ({{ usedReceivingAddresses.length }})
              <q-icon name="expand_more" class="chevron" :class="{ collapsed: !showUsedReceiving }" />
            </td>
          </tr>
        </tbody>
        <tbody v-if="showUsedReceiving" class="used-addresses">
          <tr v-for="row in usedReceivingAddresses" :key="row.index" class="selectable-row" @click="toggleAddress(row.address)">
            <td><input type="checkbox" :checked="selectedAddresses.has(row.address)" @click.stop="toggleAddress(row.address)"></td>
            <td class="mono">{{ row.index }}</td>
            <td class="mono" :title="row.address">{{ truncateAddress(row.address) }}</td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
        <!-- Unused receiving addresses -->
        <tbody>
          <tr v-for="row in unusedReceivingAddresses" :key="row.index" class="selectable-row" @click="toggleAddress(row.address)">
            <td><input type="checkbox" :checked="selectedAddresses.has(row.address)" @click.stop="toggleAddress(row.address)"></td>
            <td class="mono">{{ row.index }}</td>
            <td class="mono" :title="row.address">{{ truncateAddress(row.address) }}</td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="description">{{ t('hdAddresses.noAddresses') }}</div>
    </template>

    <!-- Change Addresses -->
    <div class="group-header" @click="toggleSection('change')">
      {{ t('hdAddresses.changeAddresses') }} ({{ filteredChangeCount }})
      <q-icon name="expand_more" class="chevron" :class="{ collapsed: collapsedSections.change }" />
    </div>
    <template v-if="!collapsedSections.change">
      <table v-if="filteredChangeCount" class="address-table">
        <thead>
          <tr>
            <th></th>
            <th>{{ t('hdAddresses.columns.index') }}</th>
            <th>{{ t('hdAddresses.columns.address') }}</th>
            <th>{{ t('hdAddresses.columns.balance') }}</th>
            <th>{{ t('hdAddresses.columns.txs') }}</th>
          </tr>
        </thead>
        <!-- Used change addresses (collapsible) -->
        <tbody v-if="usedChangeAddresses.length">
          <tr class="section-toggle" @click="showUsedChange = !showUsedChange">
            <td colspan="5">
              {{ t('hdAddresses.usedAddresses') }} ({{ usedChangeAddresses.length }})
              <q-icon name="expand_more" class="chevron" :class="{ collapsed: !showUsedChange }" />
            </td>
          </tr>
        </tbody>
        <tbody v-if="showUsedChange" class="used-addresses">
          <tr v-for="row in usedChangeAddresses" :key="row.index" class="selectable-row" @click="toggleAddress(row.address)">
            <td><input type="checkbox" :checked="selectedAddresses.has(row.address)" @click.stop="toggleAddress(row.address)"></td>
            <td class="mono">{{ row.index }}</td>
            <td class="mono" :title="row.address">{{ truncateAddress(row.address) }}</td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
        <!-- Unused change addresses -->
        <tbody>
          <tr v-for="row in unusedChangeAddresses" :key="row.index" class="selectable-row" @click="toggleAddress(row.address)">
            <td><input type="checkbox" :checked="selectedAddresses.has(row.address)" @click.stop="toggleAddress(row.address)"></td>
            <td class="mono">{{ row.index }}</td>
            <td class="mono" :title="row.address">{{ truncateAddress(row.address) }}</td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="description">{{ t('hdAddresses.noAddresses') }}</div>
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

.chevron {
  vertical-align: -0.2em;
  transition: transform 0.2s;
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.description {
  color: #888;
  margin: 5px 0 10px 0;
}

.address-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 13px;
}

.address-table th,
.address-table td {
  padding: 3px 6px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #ddd);
}

.address-table th {
  color: #888;
}

.mono {
  font-family: monospace;
}

.selectable-row {
  cursor: pointer;
}

.selectable-row:hover {
  background-color: rgba(0, 123, 255, 0.1);
}

.section-toggle {
  cursor: pointer;
  user-select: none;
}

.section-toggle td {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #888;
}

.used-addresses tr {
  border-left: 3px solid #888;
}

.used-addresses tr td:first-child {
  padding-left: 2rem;
}
</style>
