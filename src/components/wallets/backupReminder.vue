<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { menuSectionViewBase } from 'src/stores/constants'
  import { backupReminderDue, backupReminderSnoozeMs } from 'src/utils/wallet/backupReminder'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const show = computed(() => {
    const walletName = store.activeWalletName;
    const status = settingsStore.getBackupStatus(walletName);
    const holdsCoins = (store.walletUtxos?.length ?? 0) > 0;
    const snoozedUntil = settingsStore.getWalletMetadata(walletName).backupReminderSnoozedUntil;
    return backupReminderDue(status, holdsCoins, snoozedUntil, Date.now());
  });
  function remindLater() {
    settingsStore.snoozeBackupReminder(store.activeWalletName, Date.now() + backupReminderSnoozeMs);
  }
</script>

<template>
  <div v-if="show" class="backupReminder" role="status">
    <q-icon name="warning" size="22px" class="backupReminderIcon" />
    <div class="backupReminderText">
      <div class="backupReminderTitle">{{ t('backupWallet.reminder.title') }}</div>
      <div>{{ t('backupWallet.reminder.text') }}</div>
    </div>
    <div class="backupReminderActions">
      <button type="button" class="button primary" @click="store.changeView(menuSectionViewBase + 1)">
        {{ t('backupWallet.reminder.backupNow') }}
      </button>
      <button type="button" class="backupReminderLater" @click="remindLater()">
        {{ t('backupWallet.reminder.later') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.backupReminder {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin: 16px 0 24px;
  padding: 12px 14px;
  border: 1px solid #e65100;
  border-radius: 8px;
  text-align: left;
}
body.dark .backupReminder {
  border-color: #ffcc80;
}
.backupReminderIcon {
  flex-shrink: 0;
  color: #e65100;
}
body.dark .backupReminderIcon {
  color: #ffcc80;
}
/* the text takes the room beside the icon, and the actions wrap under it where that is too little */
.backupReminderText {
  flex: 1 1 240px;
  font-size: 14px;
}
.backupReminderTitle {
  font-weight: 600;
}
.backupReminderActions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}
.backupReminderActions .button {
  margin: 0;
}
.backupReminderLater {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--font-color);
  text-decoration: underline;
  white-space: nowrap;
}
</style>
