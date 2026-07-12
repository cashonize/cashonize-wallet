<script setup lang="ts">
  import { computed } from 'vue';
  import { useQuasar } from 'quasar';
  import { useStore } from 'src/stores/store';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useWizardconnectStore } from 'src/stores/wizardconnectStore'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  // Expose to 'connectDapp' parent component.
  defineExpose({
    connectDappUriInput
  });

  const $q = useQuasar();
  const store = useStore();
  const settingsStore = useSettingsStore();

  const wizardconnectStore = useWizardconnectStore();

  // WizardConnect requires an HD wallet (see wizardconnectStore.pair)
  const isHdWallet = computed(() => settingsStore.getWalletType(store.activeWalletName) === 'hd');

  // Note: the initialization is awaited when the function is used in the 'connectDapp' component.
  async function connectDappUriInput(url: string){
    try {
      await wizardconnectStore.pair(url);
    } catch(error) {
      const errorMessage = caughtErrorToString(error)
      console.error(errorMessage)

      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: 'negative'
      })
    }
  }

  // A connection's status reflects the Nostr relay, not the dapp: the relay can be
  // connected while the dapp has not (yet) announced itself with dapp_ready. Only show
  // "Connected" once the dapp is actually there (it sent its name); a relay-only
  // connection shows "Waiting for dApp..." instead.
  function isDappConnected(connection: { status: { status: string }, dappName: string | null }): boolean {
    return connection.status.status === 'connected' && connection.dappName !== null;
  }

  function statusLabel(connection: { status: { status: string }, dappName: string | null }): string {
    if (connection.status.status === 'reconnecting') return t('wizardConnect.sessions.statusReconnecting');
    if (connection.status.status !== 'connected') return t('wizardConnect.sessions.statusDisconnected');
    return isDappConnected(connection)
      ? t('wizardConnect.sessions.statusConnected')
      : t('wizardConnect.sessions.statusWaitingForDapp');
  }
</script>

<template>
    <!-- Sessions -->
    <fieldset class="item">
      <legend>{{ t('wizardConnect.sessions.title') }}</legend>
      <div class="wiz-session-items-container">
        <!-- Iterate over active connections -->
        <template v-for="(connection, connectionId) of wizardconnectStore.connections" :key="connectionId">
          <div class="wiz-session-item">
            <div class="wiz-session-item-app-icon">
              <img v-if="connection.dappIcon" :src="connection.dappIcon" />
            </div>
            <div class="wiz-session-item-details-container">
              <div>{{ connection.dappName ?? t('wizardConnect.sessions.unknownDapp') }}</div>
              <div :class="'wiz-session-status ' + (isDappConnected(connection) ? 'wiz-session-status-connected' : '')">
                {{ statusLabel(connection) }}
              </div>
            </div>
            <div class="wiz-session-item-action-container">
              <div class="wiz-session-item-action-icon" @click="wizardconnectStore.disconnectSession(String(connectionId))">
                <img :src="settingsStore.darkMode? 'images/trashLightGrey.svg': 'images/trash.svg'" style="max-width: none" />
              </div>
            </div>
          </div>
        </template>
        <!-- Show Empty Message if no Sessions are active -->
        <template v-if="!Object.keys(wizardconnectStore.connections).length">
          <div v-if="isHdWallet" class="q-pa-md">{{ t('wizardConnect.sessions.noActiveSessions') }}</div>
          <div v-else class="q-pa-md">{{ t('wizardConnect.sessions.notAvailableForWalletType') }}</div>
        </template>
      </div>
    </fieldset>
</template>

<style>
.wiz-session-items-container {
  display: flex;
  flex-direction: column;
}

.wiz-session-item {
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 10px;
  padding: 7px;
}

.wiz-session-item-details-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.wiz-session-item-app-icon {
  display: flex;
  align-items: center;
  height: 64px;
  width: 64px;
}

.wiz-session-status {
  font-size: smaller;
  color: var(--color-grey);
}

.wiz-session-status-connected {
  color: hsla(160, 100%, 37%, 1);
}

.wiz-session-item-action-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.wiz-session-item-action-icon {
  height: 24px;
  cursor: pointer;
}
</style>
