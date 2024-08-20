
<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  import { useCashconnectStore } from 'src/stores/cashconnectStore'

  const store = useStore()

  if(!store.wallet) {
    throw new Error('store.wallet is falsy');
  }

  const cashconnectStore = useCashconnectStore(store.wallet);
</script>

<template>
  <!-- CashConnect (Vue Container) -->
  <div id="cashconnect-sessions-vue">
    <!-- Sessions -->
    <fieldset style="display: block; margin-top: 15px">
      <legend>CashConnect Sessions (Pre-Alpha)</legend>
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
              <div class="cc-session-item-action-icon" @click="cashconnectStore.cashConnectWallet.disconnectSession(topic)"><img class="trashIcon icon"></div>
            </div>
          </div>
        </template>
      </div>
    </fieldset>
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
  width: 24px;
  cursor: pointer;
}
</style>
