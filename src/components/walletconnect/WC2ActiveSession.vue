<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue';
  import DappSessionCard from 'src/components/general/dappSessionCard.vue';
  import { computed, ref, toRefs } from 'vue';
  import type { SessionTypes } from '@walletconnect/types'
  import { useWindowSize } from 'src/utils/composables'
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
</script>

<template>
  <DappSessionCard
    :dapp-metadata="dappMetadata"
    :name-suffix="displaySessionId"
    :connected-addresses="connectedAddresses"
    @settings="sessionSettingsWC = sessionId"
    @remove="emit('deleteSession', sessionId)"
  />

  <div v-if="sessionSettingsWC">
    <WC2SessionSettingsDialog :sessionId="sessionSettingsWC" @hide="sessionSettingsWC=''" :dapp-metadata="dappMetadata" :connected-addresses="connectedAddresses"/>
  </div>
</template>
