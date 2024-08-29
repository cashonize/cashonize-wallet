<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()
  import type { DappMetadata } from "src/interfaces/interfaces"
  const emit = defineEmits(['deleteSession']);

  defineProps<{
    dappMetadata: DappMetadata,
    sessionId: string
  }>()
</script>

<template>
  <div style="padding: 7px;" class="dialogFieldset">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0]" style="display: flex; height: 50px; width: 50px;">
      <div style="margin-left: 10px; width: 100%;">
        <div>{{ dappMetadata.name }}</div>
        <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
        <div>{{ dappMetadata.description }}</div>
      </div>
      <div style="cursor: pointer;" @click="emit('deleteSession', sessionId)">
        <img :src="settingsStore.darkMode? 'images/trashGrey.svg': 'images/trash.svg'"/>
      </div>
    </div>
  </div>
</template>

<style scoped>
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
</style>