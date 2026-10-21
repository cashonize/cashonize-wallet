<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { sanitizeUrl } from 'src/utils/utils'
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue';
  import { computed, ref, toRefs } from 'vue';
  import type { SessionTypes } from '@walletconnect/types'
  import { useWindowSize } from 'src/utils/composables'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'
  import { iconSettings, iconTrash } from 'src/utils/icons/svgIcons'
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

  const safeUrl = sanitizeUrl(props.dappMetadata.url);
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
  <div class="wc-session-card">
    <img class="wc-session-icon" :src="dappMetadata.icons[0] ?? ''">
    <div class="wc-session-details">
      <div>{{ dappMetadata.name + displaySessionId }}</div>
      <a v-if="safeUrl" :href="safeUrl" target="_blank" class="wc-session-url">{{ dappMetadata.url }}</a>
      <span v-else style="color: var(--color-error);">{{ t('common.unsafeUrl') }}</span>
      <div class="wc-session-description">{{ dappMetadata.description }}</div>
      <div v-for="addr in connectedAddresses" :key="addr" class="connected-address mono" :title="addr">
        <template v-if="width < 550">{{ shortenAddress(addr) }}</template>
        <template v-else>{{ addr }}</template>
      </div>
    </div>
    <div class="wc-session-actions">
      <q-icon class="app-icon" :name="iconSettings" size="16px" style="cursor: pointer; max-width: none;" @click="() => sessionSettingsWC = sessionId" />
      <q-icon class="app-icon app-icon--trash" :name="iconTrash" size="16px" style="cursor: pointer; max-width: none;" @click="emit('deleteSession', sessionId)" />
    </div>
  </div>

  <div v-if="sessionSettingsWC">
    <WC2SessionSettingsDialog :sessionId="sessionSettingsWC" @hide="sessionSettingsWC=''" :dapp-metadata="dappMetadata" :connected-addresses="connectedAddresses"/>
  </div>
</template>

<style scoped>
  .wc-session-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px;
  }
  .wc-session-icon {
    height: 54px;
    width: 54px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  /* min-width lets the details shrink inside the flex row; the dapp's name, url and description
     are its own and can hold long unbroken strings */
  .wc-session-details {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* wrapped rather than cut off: the end of the url is what tells a dapp's domain from a
     lookalike, and preview deployment urls run long */
  .wc-session-url {
    display: block;
    font-size: 13px;
  }
  .wc-session-description {
    font-size: 13px;
  }
  .wc-session-actions {
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex-shrink: 0;
  }
  .connected-address {
    color: #888;
    font-size: 12px;
    margin-top: 2px;
  }
  .mono {
    font-family: monospace;
  }
  @media only screen and (max-width: 480px) {
    .wc-session-card {
      gap: 10px;
    }
  }
</style>