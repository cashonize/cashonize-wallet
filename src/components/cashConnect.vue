
<script setup lang="ts">
  import { ref } from 'vue'
  import { useQuasar } from 'quasar';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useCashconnectStore } from 'src/stores/cashconnectStore'

  const $q = useQuasar();

  const store = useStore()
  const settingsStore = useSettingsStore();

  if(!store.wallet) {
    throw new Error('store.wallet is falsy');
  }

  // TODO: Why does this type not work? They're the same?
  const cashconnectStore = await useCashconnectStore(store.wallet);

  // State.
  const dappUriInput = ref("");

  // Methods.
  async function connectDappUriInput(){
    try {
      cashconnectStore.pair(dappUriInput.value);
    } catch(error) {
      $q.notify({
        message: `${error}`,
        icon: 'warning',
        color: 'negative'
      })
    }
  }
</script>

<template>
    <!-- Sessions -->
    <fieldset class="item">
      <legend>CashConnect (Pre-Alpha)</legend>
      <!-- TODO: Temporary - unless we want to keep these separate -->
      <input v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem;">
        <input @click="connectDappUriInput" type="button" class="primaryButton" id="connect" value="Connect New dApp">
      </div>
      <!-- Sessions -->
      <div class="cc-session-items-container">
        <!-- Iterate over active sessions -->
        <template v-for="(session, topic) of cashconnectStore.sessions" :key="topic">
          <div class="cc-session-item">
            <div class="cc-session-item-app-icon"><img :src="session.peer.metadata.icons[0]"></div>
            <div class="cc-session-item-details-container">
              <div>{{ session.peer.metadata.name }}</div>
              <div><a href="session.peer.metadata.url" target="_blank">{{ session.peer.metadata.url }}</a></div>
              <div>{{ session.peer.metadata.description }}</div>
            </div>
            <div class="cc-session-item-action-container">
              <div class="cc-session-item-action-icon" @click="cashconnectStore.cashConnectWallet.disconnectSession(topic)"><img :src="settingsStore.darkMode? 'images/trashGrey.svg': 'images/trash.svg'" style="cursor: pointer;" /></div>
            </div>
          </div>
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
  width: 24px;
  cursor: pointer;
}
</style>
