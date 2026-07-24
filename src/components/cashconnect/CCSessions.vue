<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useCashconnectStore } from 'src/stores/cashconnectStore'
  import { sanitizeUrl } from 'src/utils/utils'
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  const settingsStore = useSettingsStore();

  const cashconnectStore = useCashconnectStore();
</script>

<template>
    <!-- Section inside the shared 'dApp Sessions' fieldset (connectDapp.vue); hidden when empty -->
    <div v-if="Object.keys(cashconnectStore.sessions).length">
      <div class="sessions-section-heading">{{ t('cashConnect.sessions.title') }}</div>
      <div class="cc-session-items-container">
        <!-- Iterate over active sessions -->
        <template v-for="(session, topic) of cashconnectStore.sessions" :key="topic">
          <div class="cc-session-item">
            <div class="cc-session-item-app-icon"><img :src="session.dapp.icon ?? ''" /></div>
            <div class="cc-session-item-details-container">
              <div>{{ session.dapp.name }}</div>
              <div>
                <a v-if="sanitizeUrl(session.dapp.url)" :href="sanitizeUrl(session.dapp.url)" target="_blank">{{ session.dapp.url }}</a>
                <span v-else style="color: var(--color-error);">{{ t('common.unsafeUrl') }}</span>
              </div>
              <div>{{ session.dapp.description }}</div>
            </div>
            <div class="cc-session-item-action-container">
              <div class="cc-session-item-action-icon" @click="cashconnectStore.disconnectSession(topic)">
                <img :src="settingsStore.darkMode? 'images/trashLightGrey.svg': 'images/trash.svg'" style="max-width: none" />
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
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
