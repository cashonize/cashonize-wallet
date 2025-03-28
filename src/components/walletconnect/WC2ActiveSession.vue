<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import WC2SessionSettingsDialog from 'src/components/walletconnect/WC2SessionSettingsDialog.vue';
  import { ref } from 'vue';
  import { useSettingsStore } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()

  const emit = defineEmits(['deleteSession']);

  defineProps<{
    dappMetadata: DappMetadata,
    sessionId: string
  }>()

  const sessionSettingsWC = ref('' as string);

</script>

<template>
  <div style="padding: 7px;" class="dialogFieldset">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
      <div style="margin-left: 15px; width: 100%;">
        <div>{{ dappMetadata.name }}</div>
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