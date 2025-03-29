<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue';
  import { computed, ref, toRefs } from 'vue';
  import type { SessionTypes } from '@walletconnect/types'
  import { useWindowSize } from '@vueuse/core'
  import { useSettingsStore } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()

  const { width } = useWindowSize();
  const isMobilePhone = width.value < 480

  const emit = defineEmits(['deleteSession']);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    sessionId: string
    activeSessions: Record<string, SessionTypes.Struct>
  }>()
  const { activeSessions } = toRefs(props);

  const sessionSettingsWC = ref('' as string);

  const displaySessionId = computed(() => {
    const session = activeSessions.value[props.sessionId];
    const sessions = activeSessions.value;
    const sessionKeys = Object.keys(sessions);
    const sessionName = session.peer.metadata.name;

    // Check if there's another session with the same name but a different topic
    const hasDuplicateName = sessionKeys.some((key) =>
      sessions[key].peer.metadata.name === sessionName &&
      key !== session.topic
    );

    // If duplicated, return part of the session id
    const sessionPrefix = !isMobilePhone ?'session ' : ''
    return hasDuplicateName? `- ${sessionPrefix} ${session.topic.slice(0, 6)}`: '';
  });
</script>

<template>
  <div style="padding: 7px;" class="dialogFieldset">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
      <div style="margin-left: 15px; width: 100%;">
        <div>{{ dappMetadata.name + displaySessionId }}</div>
        <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
        <div>{{ dappMetadata.description }}</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <img style="cursor: pointer;max-width: none;"
          @click="() => sessionSettingsWC = sessionId" 
          :src="settingsStore.darkMode? 'images/settingsLightGrey.svg': 'images/settings.svg'"
        />
        <img style="cursor: pointer;max-width: none;"
          @click="emit('deleteSession', sessionId)"
          :src="settingsStore.darkMode? 'images/trashLightGrey.svg': 'images/trash.svg'"
        />
      </div>
    </div>
  </div>

  <div v-if="sessionSettingsWC">
      <WC2SessionSettingsDialog :sessionId="sessionSettingsWC" @hide="sessionSettingsWC=''" :dapp-metadata="dappMetadata"/>
    </div>
</template>

<style scoped>
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
</style>