<script setup lang="ts">
  import { computed } from 'vue';
  import { useQuasar } from 'quasar';
  import { decodeKeyExchangeURI } from '@wizardconnect/core';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useWizardconnectStore } from 'src/stores/wizardconnectStore'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useWindowSize } from 'src/utils/composables'
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  // Expose to 'connectDapp' parent component.
  defineExpose({
    connectDappUriInput
  });

  const $q = useQuasar();
  const settingsStore = useSettingsStore();

  const wizardconnectStore = useWizardconnectStore();

  const { width } = useWindowSize();
  const isMobilePhone = computed(() => width.value < 480);

  // When multiple sessions share the same dapp name, append a short session identifier
  // (mirrors WC2ActiveSession). The manager's internal connection id is regenerated on
  // every reconnect, so the stable identifier is the dapp's pubkey from the pairing URI.
  function sessionIdTag(connectionId: string): string {
    const connections = wizardconnectStore.connections;
    const connection = connections[connectionId];
    if (!connection) return '';
    const hasDuplicateName = Object.entries(connections).some(([otherId, otherConnection]) =>
      otherConnection.dappName === connection.dappName && otherId !== connectionId
    );
    if (!hasDuplicateName) return '';
    try {
      const dappPubkey = decodeKeyExchangeURI(connection.uri).publicKey;
      const sessionPrefix = !isMobilePhone.value ? t('wizardConnect.sessions.session') + ' ' : '';
      return ` - ${sessionPrefix}${dappPubkey.slice(0, 6)}`;
    } catch {
      return '';
    }
  }

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
    <!-- Section inside the shared 'dApp Sessions' fieldset (connectDapp.vue); hidden when empty -->
    <div v-if="Object.keys(wizardconnectStore.connections).length">
      <div class="sessions-section-heading">{{ t('wizardConnect.sessions.title') }}</div>
      <div class="wiz-session-items-container">
        <!-- Iterate over active connections -->
        <template v-for="(connection, connectionId) of wizardconnectStore.connections" :key="connectionId">
          <div class="wiz-session-item">
            <div class="wiz-session-item-app-icon">
              <img v-if="connection.dappIcon" :src="connection.dappIcon" />
            </div>
            <div class="wiz-session-item-details-container">
              <div>{{ (connection.dappName ?? t('wizardConnect.sessions.unknownDapp')) + sessionIdTag(String(connectionId)) }}</div>
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
      </div>
    </div>
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
