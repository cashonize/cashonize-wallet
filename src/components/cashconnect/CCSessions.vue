<script setup lang="ts">
  import { useQuasar } from 'quasar';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useCashconnectStore } from 'src/stores/cashconnectStore'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { sanitizeUrl } from 'src/utils/utils'
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  // Expose to 'connectDapp' parent component.
  defineExpose({
    connectDappUriInput
  });

  const $q = useQuasar();
  const settingsStore = useSettingsStore();

  const cashconnectStore = useCashconnectStore();

  // Note: the initialization is awaited when the function is used in the 'connectDapp' component.
  async function connectDappUriInput(url: string){
    try {
      await cashconnectStore.pair(url);
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
</script>

<template>
    <!-- Sessions -->
    <fieldset class="item">
      <legend>{{ t('cashConnect.sessions.title') }}</legend>
      <!-- Sessions -->
      <div class="cc-session-items-container">
        <!-- Iterate over active sessions -->
        <template v-for="(session, topic) of cashconnectStore.sessions" :key="topic">
          <div class="cc-session-item">
            <div class="cc-session-item-app-icon"><img :src="session.peer.metadata.icons[0] ?? ''" /></div>
            <div class="cc-session-item-details-container">
              <div>{{ session.peer.metadata.name }}</div>
              <div>
                <a v-if="sanitizeUrl(session.peer.metadata.url)" :href="sanitizeUrl(session.peer.metadata.url)" target="_blank">{{ session.peer.metadata.url }}</a>
                <span v-else style="color: var(--color-error);">{{ t('common.unsafeUrl') }}</span>
              </div>
              <div>{{ session.peer.metadata.description }}</div>
            </div>
            <div class="cc-session-item-action-container">
              <div class="cc-session-item-action-icon" @click="cashconnectStore.disconnectSession(topic)">
                <img :src="settingsStore.darkMode? 'images/trashLightGrey.svg': 'images/trash.svg'" style="max-width: none" />
              </div>
            </div>
          </div>
        </template>
        <!-- Show Empty Message if no Sessions are active -->
        <template v-if="!Object.keys(cashconnectStore.sessions).length">
          <div class="q-pa-md">{{ t('cashConnect.sessions.noActiveSessions') }}</div>
        </template>
      </div>
    </fieldset>
</template>

<style>
.cc-session-items-container {
  display: flex;
  flex-direction: column;
}

.cc-session-item {
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 10px;
  padding: 7px;
}

.cc-session-item-details-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.cc-session-item-app-icon {
  display: flex;
  align-items: center;
  height: 64px;
  width: 64px;
}

.cc-session-item-action-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cc-session-item-action-icon {
  height: 24px;
  cursor: pointer;
}
</style>
