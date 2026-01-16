<script setup lang="ts">
  import { computed } from 'vue'
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const MAX_WALLETS = 20

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()

  const canAddMoreWallets = computed(() => store.availableWallets.length < MAX_WALLETS)

  function formatCreationDate(walletName: string): string {
    const meta = settingsStore.getWalletMetadata(walletName);
    if (!meta.createdAt) return '';
    const date = new Date(meta.createdAt);
    const dateFormat = settingsStore.dateFormat;
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    if (dateFormat === 'MM/DD/YY') return `${month}/${day}/${year}`;
    if (dateFormat === 'YY-MM-DD') return `${year}-${month}-${day}`;
    return `${day}/${month}/${year}`; // DD/MM/YY default
  }

  async function handleSwitchWallet(walletName: string) {
    if (walletName === store.activeWalletName) return;
    // Check if the wallet exists on current network
    // Note: wallets are created for both networks by default, very old wallets may be the exception
    const walletInfo = store.availableWallets.find(w => w.name === walletName);
    if (!walletInfo) return;
    const networkSelector = store.network === 'mainnet' ? 'hasMainnet' : 'hasChipnet';
    const walletExistsOnCurrentNetwork = walletInfo[networkSelector];
    // If wallet does not exist on current network, use network where it exists
    if (!walletExistsOnCurrentNetwork) {
      const walletNetwork = walletInfo.hasMainnet ? 'mainnet' : 'chipnet';
      store.activeWalletName = walletName;
      localStorage.setItem('activeWalletName', walletName);
      settingsStore.hasPlayedAnimation = false;
      void store.changeNetwork(walletNetwork);
      $q.notify({
        message: `Switched to ${walletNetwork} for wallet "${walletName}"`,
        icon: 'info',
        color: "grey-6"
      });
      return;
    }
    try {
      await store.switchWallet(walletName);
    } catch (error) {
      $q.notify({
        message: `Failed to switch wallet: ${error instanceof Error ? error.message : 'Unknown error'}`,
        icon: 'warning',
        color: "red"
      });
    }
  }

  async function deleteSingleWallet(walletName: string) {
    if (walletName === store.activeWalletName) {
      $q.notify({
        message: "Cannot delete the currently active wallet",
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      $q.dialog({
        title: 'Delete Wallet',
        message: `Are you sure you want to delete the wallet "${walletName}"?<br>This action cannot be undone.`,
        html: true,
        cancel: { flat: true, color: 'dark' },
        ok: { label: 'Delete', color: 'red', textColor: 'white' },
        persistent: true
      }).onOk(() => resolve(true))
        .onCancel(() => resolve(false))
    });
    if (confirmed) {
      try {
        await store.deleteWallet(walletName);
        // Clear backup status and metadata for deleted wallet
        settingsStore.clearBackupStatus(walletName);
        settingsStore.clearWalletMetadata(walletName);
        $q.notify({
          message: `Wallet "${walletName}" deleted`,
          icon: 'info',
          color: "grey-6"
        });
      } catch (error) {
        $q.notify({
          message: typeof error === 'string' ? error : (error instanceof Error ? error.message : "Failed to delete wallet"),
          icon: 'warning',
          color: "red"
        });
      }
    }
  }
</script>

<template>
  <div>
    <div style="margin-bottom: 15px;">
      Current wallet: <span class="wallet-name-styled">{{ store.activeWalletName }}</span>
    </div>

    <div v-if="store.availableWallets.length > 0" style="margin-bottom: 20px;">
      <div style="margin-bottom: 10px;">Your wallets ({{ store.availableWallets.length }}):</div>
      <div
        v-for="wallet in store.availableWallets"
        :key="wallet.name"
        class="wallet-item"
        :class="{ active: wallet.name === store.activeWalletName }"
      >
        <span
          class="wallet-section-left"
          :class="{ clickable: wallet.name !== store.activeWalletName }"
          @click="handleSwitchWallet(wallet.name)"
        >
          <span class="wallet-name-styled">{{ wallet.name }}</span>
          <span v-if="wallet.name === store.activeWalletName" class="active-badge">(current)</span>
          <span v-if="!wallet.hasChipnet" class="network-badge">(mainnet only)</span>
          <span v-else-if="!wallet.hasMainnet" class="network-badge">(chipnet only)</span>
        </span>
        <span class="wallet-section-center">
          <span class="creation-date-prefix">{{ settingsStore.getBackupStatus(wallet.name) === 'imported' ? 'Import date: ' : 'Creation date: ' }}</span>{{ formatCreationDate(wallet.name) || 'Unknown' }}
        </span>
        <span class="wallet-section-right">
          <span class="backup-status-badge" :class="settingsStore.getBackupStatus(wallet.name)">
            {{ settingsStore.getBackupStatus(wallet.name) === 'none' ? 'not backed up' : settingsStore.getBackupStatus(wallet.name) === 'imported' ? 'imported' : 'backed up' }}
          </span>
          <button
            v-if="wallet.name !== store.activeWalletName"
            class="delete-wallet-btn"
            @click.stop="deleteSingleWallet(wallet.name)"
            title="Delete wallet"
          >
            ✕
          </button>
        </span>
      </div>
    </div>

    <div v-if="canAddMoreWallets" style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(9)">
      → Add new wallet
    </div>
    <div v-else style="margin-bottom: 15px; color: #888;">
      Number of wallets limited to {{ MAX_WALLETS }} for now
    </div>
  </div>
</template>

<style scoped>
.wallet-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 8px;
  background-color: #f5f5f5;
  border-radius: 6px;
}
body.dark .wallet-item {
  background-color: #1a1a2e;
}
.wallet-item.active {
  border-left: 3px solid var(--color-primary);
}
.wallet-section-left {
  flex: 1;
  min-width: 0;
}
.wallet-section-left.clickable {
  cursor: pointer;
}
.wallet-section-left.clickable:hover {
  color: var(--color-primary);
}
.wallet-section-center {
  font-size: 12px;
  color: #888;
  text-align: center;
  padding: 0 12px;
}
.wallet-section-right {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-width: 0;
}
.active-badge {
  color: var(--color-primary);
  font-size: smaller;
  margin-left: 8px;
}
.network-badge {
  color: grey;
  font-size: smaller;
  margin-left: 8px;
}
.delete-wallet-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
  border-radius: 4px;
}
.delete-wallet-btn:hover {
  background-color: rgba(188, 30, 30, 0.1);
  color: rgb(188, 30, 30);
}
.wallet-name-styled {
  font-family: monospace;
  background-color: #f0f0f0;
  padding: 2px 8px;
  border-radius: 4px;
}
body.dark .wallet-name-styled {
  background-color: #2a2a3e;
}
.creation-date-prefix {
  display: none;
}
@media (min-width: 600px) {
  .creation-date-prefix {
    display: inline;
  }
}
.backup-status-badge {
  font-size: 12px;
  color: #888;
  margin-right: 8px;
}
.backup-status-badge.none {
  color: #e65100;
}
body.dark .backup-status-badge.none {
  color: #ffcc80;
}
.backup-status-badge.verified,
.backup-status-badge.imported {
  color: #2e7d32;
}
body.dark .backup-status-badge.verified,
body.dark .backup-status-badge.imported {
  color: #a5d6a7;
}
</style>
