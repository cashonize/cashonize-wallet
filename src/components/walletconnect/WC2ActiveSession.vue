<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue';
  import { computed, ref, toRefs } from 'vue';
  import type { SessionTypes } from '@walletconnect/types'
  import { useWindowSize } from '@vueuse/core'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'
  const settingsStore = useSettingsStore()
  const store = useStore()
  const { t } = useI18n()

  const { width } = useWindowSize();
  const isMobilePhone = computed(() => width.value < 480);

  const emit = defineEmits(['deleteSession']);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    sessionId: string
    activeSessions: Record<string, SessionTypes.Struct>
  }>()
  const { activeSessions } = toRefs(props);

  const sessionSettingsWC = ref('');

  const displaySessionId = computed(() => {
    const session = activeSessions.value[props.sessionId] as SessionTypes.Struct;
    const sessionName = session.peer.metadata.name;

    // Check if there's another session with the same name but a different topic
    const sessions = activeSessions.value;
    const hasDuplicateName = Object.entries(sessions).some(([key, otherSession]) =>
      otherSession.peer.metadata.name === sessionName &&
      key !== session.topic
    );

    // If duplicated, return part of the session id
    const sessionPrefix = !isMobilePhone.value ? t('walletConnect.sessions.session') + ' ' : ''
    return hasDuplicateName? `- ${sessionPrefix} ${session.topic.slice(0, 6)}`: '';
  });

  const connectedAddresses = computed(() => {
    const isHD = settingsStore.getWalletType(store.activeWalletName) === 'hd';
    if (!isHD) return [];
    const session = activeSessions.value[props.sessionId] as SessionTypes.Struct;
    const accounts = session.namespaces?.bch?.accounts;
    if (!accounts?.length) return [];
    // account format is "bch:<address>", strip the "bch:" prefix
    return accounts.map(account => account.split(':').slice(1).join(':'));
  });

  function shortenAddress(address: string) {
    const addrWithoutPrefix = address.split(':')[1] ?? "";
    return addrWithoutPrefix.slice(0, 10) + '...' + addrWithoutPrefix.slice(-8);
  }
</script>

<template>
  <div style="padding: 7px;" class="dialogFieldset">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0] ?? ''" style="display: flex; height: 55px; width: 55px;">
      <div style="margin-left: 15px; width: 100%;">
        <div>{{ dappMetadata.name + displaySessionId }}</div>
        <a :href="dappMetadata.url" target="_blank">{{ dappMetadata.url }}</a>
        <div>{{ dappMetadata.description }}</div>
        <div v-for="addr in connectedAddresses" :key="addr" class="connected-address mono" :title="addr">
          <template v-if="width < 550">{{ shortenAddress(addr) }}</template>
          <template v-else>{{ addr }}</template>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <img style="cursor: pointer; max-width: none;"
          @click="() => sessionSettingsWC = sessionId" 
          :src="settingsStore.darkMode? 'images/settingsLightGrey.svg': 'images/settings.svg'"
        />
        <img style="cursor: pointer; max-width: none;"
          @click="emit('deleteSession', sessionId)"
          :src="settingsStore.darkMode? 'images/trashLightGrey.svg': 'images/trash.svg'"
        />
      </div>
    </div>
  </div>

  <div v-if="sessionSettingsWC">
    <WC2SessionSettingsDialog :sessionId="sessionSettingsWC" @hide="sessionSettingsWC=''" :dapp-metadata="dappMetadata" :connected-addresses="connectedAddresses"/>
  </div>
</template>

<style scoped>
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .connected-address {
    color: #888;
    font-size: 12px;
    margin-top: 2px;
  }
  .mono {
    font-family: monospace;
  }
</style>