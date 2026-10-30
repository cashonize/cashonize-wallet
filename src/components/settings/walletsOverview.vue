<script setup lang="ts">
  import { computed } from 'vue'
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { confirmDialog } from 'src/utils/txHelpers'
  import { switchWalletWithNotice, maxWallets } from 'src/utils/wallet/walletUtils'
  import type { WalletInfo } from 'src/utils/wallet/dbUtils'
  import { useI18n } from 'vue-i18n'


  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const { t } = useI18n()

  const canAddMoreWallets = computed(() => store.availableWallets.length < maxWallets)

  function formatCreationDate(walletName: string, shortYear = false): string {
    const meta = settingsStore.getWalletMetadata(walletName);
    if (!meta.createdAt) return '';
    const date = new Date(meta.createdAt);
    const dateFormat = settingsStore.dateFormat;
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    let year = date.getFullYear().toString();
    if (shortYear) year = year.slice(-2);
    if (dateFormat === 'MM/DD/YY') return `${month}/${day}/${year}`;
    if (dateFormat === 'YY-MM-DD') return `${year}-${month}-${day}`;
    return `${day}/${month}/${year}`; // DD/MM/YY default
  }

  function getDateLabel(walletName: string, short = false): string {
    const isImported = settingsStore.getBackupStatus(walletName) === 'imported';
    if (short) return isImported ? t('walletsOverview.dateLabels.imported') + ' ' : t('walletsOverview.dateLabels.created') + ' ';
    return isImported ? t('walletsOverview.dateLabels.importDate') + ' ' : t('walletsOverview.dateLabels.creationDate') + ' ';
  }

  // Wallets on a development network get a list of their own, once there are any. An older wallet
  // that also has its chipnet copy is a mainnet wallet: the copy is the developer settings' business.
  const walletGroups = computed(() => {
    const mainnetWallets = store.availableWallets.filter(wallet => wallet.hasMainnet);
    const devWallets = store.availableWallets.filter(wallet => !wallet.hasMainnet);
    if (devWallets.length === 0) {
      return [{ title: t('walletsOverview.yourWallets', { count: mainnetWallets.length }), wallets: mainnetWallets, dev: false }];
    }
    return [
      { title: t('walletsOverview.mainnetWallets', { count: mainnetWallets.length }), wallets: mainnetWallets, dev: false },
      { title: t('walletsOverview.devWallets', { count: devWallets.length }), wallets: devWallets, dev: true },
    ].filter(group => group.wallets.length > 0);
  });
  // the network of a development wallet, shown under its name
  function devNetwork(wallet: WalletInfo): string {
    return wallet.hasChipnet ? 'chipnet' : '';
  }
  function getBackupStatusLabel(walletName: string): string {
    const status = settingsStore.getBackupStatus(walletName);
    if (status === 'none') return t('walletsOverview.backupLabels.notBackedUp');
    if (status === 'imported') return t('walletsOverview.backupLabels.imported');
    if (status === 'dismissed') return t('walletsOverview.backupLabels.dismissed');
    return t('walletsOverview.backupLabels.backedUp');
  }

  function getWalletTypeLabel(walletName: string): string {
    const walletType = settingsStore.getWalletType(walletName);
    return walletType === 'hd' ? t('walletsOverview.walletTypeHD') : t('walletsOverview.walletTypeSingle');
  }

  async function deleteSingleWallet(walletName: string) {
    if (walletName === store.activeWalletName) {
      $q.notify({
        message: t('walletsOverview.deleteWallet.cannotDeleteActive'),
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    const confirmed = await confirmDialog(
      t('walletsOverview.deleteWallet.title'),
      t('walletsOverview.deleteWallet.message', { name: walletName }),
      t('walletsOverview.deleteWallet.title'),
      'red'
    );
    if (confirmed) {
      try {
        await store.deleteWallet(walletName);
        $q.notify({
          message: t('walletsOverview.deleteWallet.deleted', { name: walletName }),
          icon: 'info',
          color: "grey-6"
        });
      } catch (error) {
        $q.notify({
          message: error instanceof Error ? error.message : t('walletsOverview.deleteWallet.failed'),
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
      {{ t('walletsOverview.currentWallet') }} <span class="wallet-name-styled">{{ store.activeWalletName }}</span>
    </div>

    <div v-for="group in walletGroups" :key="group.title" style="margin-bottom: 20px;">
      <div style="margin-bottom: 10px;">{{ group.title }}</div>
      <div
        v-for="wallet in group.wallets"
        :key="wallet.name"
        class="wallet-item"
        :class="{ active: wallet.name === store.activeWalletName, clickable: wallet.name !== store.activeWalletName }"
        :role="wallet.name !== store.activeWalletName ? 'button' : undefined"
        :tabindex="wallet.name !== store.activeWalletName ? 0 : undefined"
        @click="switchWalletWithNotice(wallet.name)"
        @keydown.enter.self="switchWalletWithNotice(wallet.name)"
      >
        <div class="wallet-row">
          <span class="wallet-section-left">
            <span class="wallet-name-styled">{{ wallet.name }}</span>
            <span v-if="wallet.name === store.activeWalletName" class="active-badge">{{ t('walletsOverview.current') }}</span>
            <span v-if="group.dev" class="wallet-network">{{ devNetwork(wallet) }}</span>
          </span>
          <span class="wallet-section-center show-desktop-only">
            <span class="wallet-type-col">{{ t('walletsOverview.walletTypeLabel') }}{{ getWalletTypeLabel(wallet.name) }}</span>
            <span class="date-separator">|</span>
            <span class="date-col">{{ getDateLabel(wallet.name) }}{{ formatCreationDate(wallet.name) || t('walletsOverview.dateLabels.unknown') }}</span>
          </span>
          <span class="wallet-section-right">
            <span class="backup-status-badge" :class="settingsStore.getBackupStatus(wallet.name) === 'none' ? 'none' : 'text-verified'">
              {{ getBackupStatusLabel(wallet.name) }}
            </span>
            <button
              v-if="wallet.name !== store.activeWalletName"
              class="delete-wallet-btn"
              @click.stop="deleteSingleWallet(wallet.name)"
              :title="t('walletsOverview.deleteWallet.buttonTitle')"
            >
              ✕
            </button>
          </span>
        </div>
        <div class="wallet-row-mobile show-mobile-only">
          <span>{{ t('walletsOverview.walletTypeLabel') }}{{ getWalletTypeLabel(wallet.name) }}</span>
          <span class="date-separator">|</span>
          <span>{{ getDateLabel(wallet.name, true) }}{{ formatCreationDate(wallet.name, true) || t('walletsOverview.dateLabels.unknown') }}</span>
        </div>
      </div>
    </div>

    <div v-if="canAddMoreWallets" style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(9)">
      {{ t('walletsOverview.addNewWallet') }}
    </div>
    <div v-else style="margin-bottom: 15px; color: #888;">
      {{ t('walletsOverview.walletLimitReached', { max: maxWallets }) }}
    </div>
  </div>
</template>

<style scoped>
.wallet-item {
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
.wallet-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wallet-row-mobile {
  font-size: 12px;
  color: #888;
  margin-top: 6px;
}
.wallet-item.clickable {
  cursor: pointer;
}
@media (hover: hover) {
  .wallet-item.clickable:hover {
    background-color: #ebebeb;
  }
  body.dark .wallet-item.clickable:hover {
    background-color: #23233d;
  }
  .wallet-item.clickable:hover .wallet-name-styled {
    color: var(--color-primary);
  }
}
.wallet-section-left {
  min-width: 180px;
}
.wallet-section-center {
  font-size: 12px;
  color: #888;
  text-align: center;
  padding: 0 12px;
}
.wallet-type-col {
  display: inline-block;
  min-width: 110px;
  text-align: right;
}
.date-col {
  display: inline-block;
  min-width: 140px;
}
.wallet-section-right {
  min-width: 120px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.active-badge {
  color: var(--color-primary);
  font-size: smaller;
  margin-left: 8px;
}
.show-mobile-only {
  display: none;
}
@media (max-width: 599px) {
  .show-mobile-only {
    display: block;
  }
}
@media (max-width: 600px) {
  .show-desktop-only {
    display: none;
  }
}
@media (max-width: 480px) {
  .active-badge {
    display: none;
  }
  .wallet-section-left {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 120px;
  }
}
.date-separator {
  color: #ccc;
  margin: 0 12px;
}
.wallet-network {
  display: block;
  /* lines up with the wallet name's text, inside its padding (.wallet-name-styled) */
  padding-left: 8px;
  font-size: 12px;
  color: #888;
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
</style>
