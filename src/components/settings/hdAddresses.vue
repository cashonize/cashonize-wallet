<script setup lang="ts">
  import { ref, computed, watchEffect } from 'vue';
  import { copyToClipboard, satsToBch } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  import { type HDWallet, type TestNetHDWallet, GAP_SIZE } from 'mainnet-js';
  import { useWindowSize } from '@vueuse/core'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480);

  interface AddressRow {
    index: number;
    address: string;
    balance: bigint;
    txCount: number;
  }

  const depositAddresses = ref<AddressRow[]>([]);
  const changeAddresses = ref<AddressRow[]>([]);
  const showUsedDeposit = ref(false);
  const showUsedChange = ref(false);

  const usedDepositAddresses = computed(() => depositAddresses.value.filter(r => r.txCount > 0));
  const unusedDepositAddresses = computed(() => depositAddresses.value.filter(r => r.txCount === 0));
  const usedChangeAddresses = computed(() => changeAddresses.value.filter(r => r.txCount > 0));
  const unusedChangeAddresses = computed(() => changeAddresses.value.filter(r => r.txCount === 0));

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

  // Rebuild when walletUtxos changes (triggers on balance/address updates)
  watchEffect(() => {
    // Access walletUtxos to establish reactive dependency
    void store.walletUtxos;
    const hdWallet = store.wallet as HDWallet | TestNetHDWallet;
    depositAddresses.value = buildAddressRows(hdWallet, hdWallet.depositIndex, false);
    changeAddresses.value = buildAddressRows(hdWallet, hdWallet.changeIndex, true);
  });
</script>

<template>
  <fieldset class="item" :class="{ dark: settingsStore.darkMode }">
    <legend>{{ t('hdAddresses.title') }}</legend>

    <!-- Deposit Addresses -->
    <details class="collapsible-section" open>
      <summary>
        <strong>{{ t('hdAddresses.depositAddresses') }}</strong> ({{ depositAddresses.length }})
        <img class="icon" :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'">
      </summary>
      <table v-if="depositAddresses.length" class="address-table">
        <thead>
          <tr>
            <th>{{ t('hdAddresses.columns.index') }}</th>
            <th>{{ t('hdAddresses.columns.address') }}</th>
            <th>{{ t('hdAddresses.columns.balance') }}</th>
            <th>{{ t('hdAddresses.columns.txs') }}</th>
          </tr>
        </thead>
        <!-- Used deposit addresses (collapsible) -->
        <tbody v-if="usedDepositAddresses.length">
          <tr class="section-toggle" @click="showUsedDeposit = !showUsedDeposit">
            <td colspan="4">
              {{ t('hdAddresses.usedAddresses') }} ({{ usedDepositAddresses.length }})
              <img class="icon" :class="{ open: showUsedDeposit }" :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'">
            </td>
          </tr>
        </tbody>
        <tbody v-if="showUsedDeposit" class="used-addresses">
          <tr v-for="row in usedDepositAddresses" :key="row.index">
            <td class="mono">{{ row.index }}</td>
            <td @click="copyToClipboard(row.address)" class="address-cell" :title="row.address">
              <span class="mono">{{ truncateAddress(row.address) }}</span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
        <!-- Unused deposit addresses -->
        <tbody>
          <tr v-for="row in unusedDepositAddresses" :key="row.index">
            <td class="mono">{{ row.index }}</td>
            <td @click="copyToClipboard(row.address)" class="address-cell" :title="row.address">
              <span class="mono">{{ truncateAddress(row.address) }}</span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="description">{{ t('hdAddresses.noAddresses') }}</div>
    </details>

    <!-- Change Addresses -->
    <details class="collapsible-section">
      <summary>
        <strong>{{ t('hdAddresses.changeAddresses') }}</strong> ({{ changeAddresses.length }})
        <img class="icon" :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'">
      </summary>
      <table v-if="changeAddresses.length" class="address-table">
        <thead>
          <tr>
            <th>{{ t('hdAddresses.columns.index') }}</th>
            <th>{{ t('hdAddresses.columns.address') }}</th>
            <th>{{ t('hdAddresses.columns.balance') }}</th>
            <th>{{ t('hdAddresses.columns.txs') }}</th>
          </tr>
        </thead>
        <!-- Used change addresses (collapsible) -->
        <tbody v-if="usedChangeAddresses.length">
          <tr class="section-toggle" @click="showUsedChange = !showUsedChange">
            <td colspan="4">
              {{ t('hdAddresses.usedAddresses') }} ({{ usedChangeAddresses.length }})
              <img class="icon" :class="{ open: showUsedChange }" :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'">
            </td>
          </tr>
        </tbody>
        <tbody v-if="showUsedChange" class="used-addresses">
          <tr v-for="row in usedChangeAddresses" :key="row.index">
            <td class="mono">{{ row.index }}</td>
            <td @click="copyToClipboard(row.address)" class="address-cell" :title="row.address">
              <span class="mono">{{ truncateAddress(row.address) }}</span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
        <!-- Unused change addresses -->
        <tbody>
          <tr v-for="row in unusedChangeAddresses" :key="row.index">
            <td class="mono">{{ row.index }}</td>
            <td @click="copyToClipboard(row.address)" class="address-cell" :title="row.address">
              <span class="mono">{{ truncateAddress(row.address) }}</span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </td>
            <td class="mono">{{ satsToBch(row.balance) }}</td>
            <td>{{ row.txCount }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="description">{{ t('hdAddresses.noAddresses') }}</div>
    </details>
  </fieldset>
</template>

<style scoped>
.collapsible-section {
  margin-bottom: 15px;
}

.collapsible-section summary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}

.collapsible-section summary::-webkit-details-marker {
  display: none;
}

.collapsible-section summary::marker {
  display: none;
  content: '';
}

.collapsible-section[open] > summary .icon {
  transform: rotate(180deg);
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

.address-cell {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
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

.section-toggle .icon.open {
  transform: rotate(180deg);
}

.used-addresses tr {
  border-left: 3px solid #888;
}

.used-addresses tr td:first-child {
  padding-left: 2rem;
}

.dark .used-addresses tr {
  border-left-color: #555;
}

/* Dark mode */
.dark .description,
.dark .address-table th {
  color: #aaa;
}

.dark .address-table th,
.dark .address-table td {
  border-bottom-color: #444;
}
</style>
